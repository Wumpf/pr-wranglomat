import { expect, it, vi } from 'vitest';
import { GitHubClient } from './client';
import { GitHubSource } from './sync';

const repo = {
  id: 1,
  fullName: 'acme/app',
  visibility: 'public' as const,
  defaultBranch: 'main',
  lastSyncStatus: 'never' as const,
};
const pull = (
  number: number,
  state: 'open' | 'closed',
  updated_at: string,
) => ({
  number,
  html_url: `https://github.com/acme/app/pull/${number}`,
  title: `PR ${number}`,
  state,
  base: { ref: 'main' },
  head: { ref: `branch-${number}` },
  created_at: updated_at,
  updated_at,
  closed_at: state === 'closed' ? updated_at : null,
});
it('downloads open and recent streams while retaining old open PRs', async () => {
  const now = new Date().toISOString();
  const fetcher = vi.fn().mockImplementation((url: string) => {
    const state = new URL(url).searchParams.get('state');
    return Promise.resolve(
      new Response(
        JSON.stringify(
          state === 'open'
            ? [pull(1, 'open', '2020-01-01T00:00:00Z')]
            : [pull(2, 'closed', now)],
        ),
        {
          headers: state === 'open' ? {} : { link: '' },
        },
      ),
    );
  });
  const result = await new GitHubSource(
    new GitHubClient('https://api.github.com', fetcher),
  ).createSnapshot(
    repo,
    { scope: { kind: 'recent', cutoffDays: 90 } },
    () => undefined,
    new AbortController().signal,
  );
  expect(result.pullRequests.map((row) => row.number).sort()).toEqual([1, 2]);
});
it('reuses a 304 cached page and gives new snapshot metadata', async () => {
  const cached = {
    key: '1|open|1',
    etag: 'etag',
    rows: [
      {
        ...pull(1, 'open', '2024-01-01T00:00:00Z'),
        repo: 'acme/app',
        repositoryId: 1,
        url: 'https://github.com/acme/app/pull/1',
        review_state: null,
        draft: false,
        author: null,
        labels: [],
        assignees: [],
        requested_reviewers: [],
        requested_teams: [],
        milestone: null,
        merged_at: null,
        fieldCompleteness: {},
        sourceUpdatedAt: null,
        fetchedAt: '2024-01-01T00:00:00Z',
        snapshotId: 'old',
      },
    ],
    updatedAt: '2024-01-01T00:00:00Z',
  };
  const cache = {
    get: vi.fn().mockResolvedValue(cached),
    set: vi.fn(),
  };
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 304 }));
  const result = await new GitHubSource(
    new GitHubClient('https://api.github.com', fetcher),
  ).createSnapshot(
    repo,
    { cache },
    () => undefined,
    new AbortController().signal,
  );
  expect(fetcher.mock.calls[0][1].headers['If-None-Match']).toBe('etag');
  expect(cache.set).not.toHaveBeenCalled();
  expect(result.pullRequests[0].snapshotId).not.toBe('old');
});
