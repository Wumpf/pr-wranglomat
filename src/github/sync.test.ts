import { describe, expect, it, vi } from 'vitest';
import { GitHubClient } from './client';
import { GitHubSource } from './sync';
import { normalizePullRequest } from '../domain/normalize';

const repository = {
  id: 7,
  fullName: 'acme/app',
  visibility: 'private' as const,
  defaultBranch: 'main',
  lastSyncStatus: 'never' as const,
};
const pull = (number: number, state: 'open' | 'closed' = 'open') => ({
  number,
  html_url: `https://github.com/acme/app/pull/${number}`,
  title: `PR ${number}`,
  state,
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

  it('follows next-only links beyond the second page', async () => {
    const fetcher = vi.fn().mockImplementation((url: string) => {
      const page = Number(new URL(url).searchParams.get('page'));
      const next =
        page === 3
          ? undefined
          : `<https://api.github.com/repos/acme/app/pulls?page=${page + 1}>; rel="next"`;
      return Promise.resolve(
        new Response(
          JSON.stringify([pull(page, page === 3 ? 'closed' : 'open')]),
          {
            headers: next ? { link: next } : {},
          },
        ),
      );
    });
    const result = await new GitHubSource(
      new GitHubClient('https://api.github.com', fetcher),
    ).createSnapshot(
      repository,
      {},
      () => undefined,
      new AbortController().signal,
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(result.pullRequests.map((row) => row.number)).toEqual([1, 2, 3]);
  });

  it('does not stage rows after a building snapshot is discarded', async () => {
    const { db } = await import('../storage/db');
    const { repositories } = await import('../storage/repositories');
    await db.delete();
    await db.open();
    await repositories.save(repository);
    await repositories.beginSnapshot(repository, 'discarded');
    await repositories.discardSnapshot(repository, 'discarded', 'cancelled');
    await repositories.stageRows(repository.id, 'discarded', [
      normalizePullRequest(
        pull(1),
        repository.id,
        repository.fullName,
        'discarded',
      ),
    ]);
    expect(await db.pullRequests.count()).toBe(0);
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
