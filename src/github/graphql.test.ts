import { expect, it, vi } from 'vitest';
import { GraphQLSource } from './graphql';

const repository = {
  id: 1,
  fullName: 'acme/app',
  visibility: 'public' as const,
  defaultBranch: 'main',
  lastSyncStatus: 'never' as const,
};
const node = (number: number) => ({
  number,
  url: `https://github.com/acme/app/pull/${number}`,
  title: `PR ${number}`,
  state: 'OPEN',
  reviewDecision: 'REVIEW_REQUIRED',
  isDraft: false,
  author: { login: 'alice' },
  labels: { nodes: [{ name: 'bug' }], pageInfo: { hasNextPage: false } },
  assignees: { nodes: [], pageInfo: { hasNextPage: false } },
  reviewRequests: {
    nodes: [
      { requestedReviewer: { login: 'bob' } },
      { requestedReviewer: { name: 'platform' } },
    ],
    pageInfo: { hasNextPage: false },
  },
  reviews: {
    nodes: [
      { author: { login: 'carol' }, state: 'COMMENTED' },
      { author: { login: 'carol' }, state: 'APPROVED' },
      { author: { login: 'dave' }, state: 'CHANGES_REQUESTED' },
    ],
    pageInfo: { hasNextPage: false },
  },
  baseRefName: 'main',
  headRefName: 'feature',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
  closedAt: null,
  mergedAt: null,
  milestone: null,
});
it('paginates typed GraphQL nodes', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            repository: {
              pullRequests: {
                nodes: [node(1)],
                pageInfo: { hasNextPage: true, endCursor: 'cursor' },
              },
            },
          },
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            repository: {
              pullRequests: {
                nodes: [node(2)],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        }),
      ),
    );
  const result = await new GraphQLSource(
    'https://api.github.com/graphql',
    fetcher,
  ).createSnapshot(
    repository,
    {},
    () => undefined,
    new AbortController().signal,
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(result.pullRequests.map((row) => row.number)).toEqual([1, 2]);
  expect(result.pullRequests[0].requested_reviewers).toEqual(['bob']);
  expect(result.pullRequests[0].requested_teams).toEqual(['platform']);
  expect(result.pullRequests[0].reviewed_by).toEqual(['carol', 'dave']);
  expect(result.pullRequests[0].review_activity).toEqual([
    { login: 'carol', states: ['commented', 'approved'] },
    { login: 'dave', states: ['changes_requested'] },
  ]);
  expect(result.pullRequests[0].review_state).toBe('review_required');
});
it('keeps every open PR while cutting old closed history', async () => {
  const oldOpen = { ...node(10), updatedAt: '2020-01-01T00:00:00Z' };
  const recentClosed = {
    ...node(11),
    state: 'CLOSED',
    updatedAt: new Date().toISOString(),
    closedAt: new Date().toISOString(),
  };
  const oldClosed = {
    ...node(12),
    state: 'CLOSED',
    updatedAt: '2020-01-01T00:00:00Z',
    closedAt: '2020-01-01T00:00:00Z',
  };
  const staged: number[] = [];
  const fetcher = vi.fn().mockImplementation((_url, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as {
      variables: { states: string[] };
    };
    const nodes = body.variables.states.includes('OPEN')
      ? [oldOpen]
      : [recentClosed, oldClosed];
    return Promise.resolve(
      new Response(
        JSON.stringify({
          data: {
            repository: {
              pullRequests: {
                nodes,
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
            rateLimit: {
              cost: 1,
              remaining: 4999,
              resetAt: '2030-01-01T00:00:00Z',
            },
          },
        }),
      ),
    );
  });
  const result = await new GraphQLSource(
    'https://api.github.com/graphql',
    fetcher,
  ).createSnapshot(
    repository,
    {
      scope: { kind: 'recent', cutoffDays: 90 },
      onPage: (rows) => {
        staged.push(...rows.map((row) => row.number));
      },
    },
    () => undefined,
    new AbortController().signal,
  );
  expect(result.pullRequests.map((row) => row.number).sort()).toEqual([10, 11]);
  expect(staged.sort()).toEqual([10, 11]);
  expect(result.snapshot.rateLimitRemaining).toBe(4999);
  expect(result.snapshot.rateLimitCost).toBe(2);
});

it('marks nested connections incomplete when GitHub truncates them', async () => {
  const truncated = {
    ...node(3),
    labels: { nodes: [{ name: 'bug' }], pageInfo: { hasNextPage: true } },
    reviews: {
      nodes: [{ author: { login: 'carol' } }],
      pageInfo: { hasNextPage: true },
    },
  };
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        data: {
          repository: {
            pullRequests: {
              nodes: [truncated],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      }),
    ),
  );
  const result = await new GraphQLSource(
    'https://api.github.com/graphql',
    fetcher,
  ).createSnapshot(
    repository,
    {},
    () => undefined,
    new AbortController().signal,
  );
  expect(result.snapshot.completeness.labels).toBe(false);
  expect(result.snapshot.completeness.reviewed_by).toBe(false);
  expect(result.pullRequests[0].fieldCompleteness.labels).toBe(false);
  expect(result.pullRequests[0].fieldCompleteness.reviewed_by).toBe(false);
});

it('classifies and retries GraphQL rate limits', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ errors: [{ type: 'RATE_LIMITED' }] }), {
        status: 200,
        headers: { 'retry-after': '0' },
      }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            repository: {
              pullRequests: {
                nodes: [node(4)],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        }),
      ),
    );
  const result = await new GraphQLSource(
    'https://api.github.com/graphql',
    fetcher,
  ).createSnapshot(
    repository,
    {},
    () => undefined,
    new AbortController().signal,
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(result.pullRequests[0].number).toBe(4);
});

it('maps an aborted GraphQL request to cancellation', async () => {
  const controller = new AbortController();
  const fetcher = vi.fn().mockImplementation(() => {
    controller.abort();
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  });
  await expect(
    new GraphQLSource('https://api.github.com/graphql', fetcher).createSnapshot(
      repository,
      {},
      () => undefined,
      controller.signal,
    ),
  ).rejects.toMatchObject({ code: 'cancelled' });
});

it('rejects malformed GraphQL responses', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ data: {} })));
  await expect(
    new GraphQLSource('https://api.github.com/graphql', fetcher).createSnapshot(
      repository,
      {},
      () => undefined,
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: 'invalid-response' });
});
