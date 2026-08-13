import { describe, expect, it, vi } from 'vitest';
import { GitHubClient } from './client';
import { GitHubSource } from './sync';

const repository = {
  id: 7,
  fullName: 'acme/app',
  visibility: 'private' as const,
  defaultBranch: 'main',
  lastSyncStatus: 'never' as const,
};
const pull = (number: number) => ({
  number,
  html_url: `https://github.com/acme/app/pull/${number}`,
  title: `PR ${number}`,
  state: 'open',
  base: { ref: 'main' },
  head: { ref: `branch-${number}` },
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  closed_at: null,
});

describe('GitHub snapshot ingestion', () => {
  it('follows Link pagination and stages each page', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([pull(1)]), {
          headers: {
            link: '<https://api.github.com/repos/acme/app/pulls?page=2>; rel="next"',
          },
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([pull(2)])));
    const pages: number[][] = [];
    const result = await new GitHubSource(
      new GitHubClient('https://api.github.com', fetcher),
    ).createSnapshot(
      repository,
      {
        onPage: (rows) => {
          pages.push(rows.map((row) => row.number));
        },
      },
      () => undefined,
      new AbortController().signal,
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(pages).toEqual([[1], [2]]);
    expect(result.pullRequests.map((row) => row.number)).toEqual([1, 2]);
  });

  it('rejects malformed pull request payloads', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('[{"number":1}]'));
    await expect(
      new GitHubSource(
        new GitHubClient('https://api.github.com', fetcher),
      ).createSnapshot(
        repository,
        {},
        () => undefined,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  });
});
