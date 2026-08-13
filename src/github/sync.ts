import { GitHubClient } from './client';
import {
  normalizePullRequest,
  type GitHubPullRequest,
} from '../domain/normalize';
import type {
  PullRequestSource,
  Credential,
  SnapshotOptions,
} from '../ingestion/source';
import type { Repository } from '../domain/repository';
import type {
  SnapshotResult,
  SnapshotScope,
  SyncProgress,
} from '../domain/snapshot';
import { AppError } from '../domain/errors';
import { parseLinkHeader } from './links';

const MAX_CONCURRENCY = 4;
const DEFAULT_SCOPE: SnapshotScope = { kind: 'open' };

export class GitHubSource implements PullRequestSource {
  constructor(
    private readonly client = new GitHubClient(),
    private readonly credential?: Credential,
  ) {}
  async resolveRepository(
    input: string,
    credential?: Credential,
    signal?: AbortSignal,
  ): Promise<Repository> {
    const full = input
      .trim()
      .replace(/^https?:\/\/github\.com\//i, '')
      .replace(/\.git$/, '')
      .replace(/\/$/, '');
    if (!/^[^/\s]+\/[^/\s]+$/.test(full))
      throw new AppError(
        'invalid-response',
        'Repository must be owner/name or a GitHub URL.',
      );
    const { data } = await this.client.request<unknown>(
      `/repos/${full}`,
      credential,
      signal,
    );
    if (!isRepositoryPayload(data))
      throw new AppError(
        'invalid-response',
        'GitHub returned malformed repository data.',
      );
    return {
      id: data.id,
      fullName: data.full_name,
      visibility: data.visibility ?? 'public',
      defaultBranch: data.default_branch,
      lastSyncStatus: 'never',
      snapshotScope: DEFAULT_SCOPE,
      ingestionTransport: 'rest',
    };
  }
  async createSnapshot(
    repository: Repository,
    options: SnapshotOptions,
    onProgress: (p: SyncProgress) => void,
    signal: AbortSignal,
  ): Promise<SnapshotResult> {
    if (options.transport === 'graphql')
      throw new AppError(
        'invalid-response',
        'GraphQL transport is not enabled.',
      );
    const snapshotId = options.snapshotId ?? crypto.randomUUID();
    const scope = options.scope ?? DEFAULT_SCOPE;
    const rows: ReturnType<typeof normalizePullRequest>[] = [];
    const seen = new Set<number>();
    let requests = 0;
    let cachedPages = 0;
    let totalPages = 0;
    let remaining: number | undefined;
    let resetAt: string | undefined;
    const startedAt = new Date().toISOString();
    const streams =
      scope.kind === 'open'
        ? [{ name: 'open', state: 'open' as const }]
        : scope.kind === 'recent'
          ? [
              { name: 'open', state: 'open' as const },
              { name: 'closed', state: 'closed' as const },
            ]
          : [{ name: 'all', state: 'all' as const }];
    try {
      for (const stream of streams) {
        const streamRows = await this.fetchStream(
          repository,
          stream.name,
          stream.state,
          scope,
          snapshotId,
          options,
          signal,
          (page, count, cached, pages, rate, reset) => {
            requests++;
            cachedPages += cached ? 1 : 0;
            totalPages = Math.max(totalPages, pages);
            remaining = rate ?? remaining;
            resetAt = reset ?? resetAt;
            onProgress({
              pages: page,
              requests,
              count: rows.length + count,
              rateLimitRemaining: remaining,
              cachedPages,
              totalPages,
              status: cached
                ? `Reused page ${page}`
                : `Downloaded page ${page}`,
            });
          },
        );
        for (const row of streamRows) {
          if (scope.kind === 'recent' && stream.state === 'closed') {
            const cutoff = Date.now() - scope.cutoffDays * 86400000;
            if (new Date(row.updated_at).valueOf() < cutoff) continue;
          }
          if (!seen.has(row.number)) {
            seen.add(row.number);
            rows.push(row);
          }
        }
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('network', 'Refresh failed.');
    }
    rows.sort(
      (a, b) => b.updated_at.localeCompare(a.updated_at) || a.number - b.number,
    );
    return {
      snapshot: {
        id: snapshotId,
        repositoryId: repository.id,
        state: 'complete',
        schemaVersion: 1,
        profile: 'core',
        source: 'github-rest',
        completeness: { core: true },
        count: rows.length,
        startedAt,
        finishedAt: new Date().toISOString(),
        requestCount: requests,
        rateLimitRemaining: remaining,
        rateLimitResetAt: resetAt,
        scope,
        transport: 'rest',
        historyComplete: scope.kind === 'complete',
      },
      pullRequests: rows,
    };
  }

  private async fetchStream(
    repository: Repository,
    stream: string,
    state: 'open' | 'closed' | 'all',
    scope: SnapshotScope,
    snapshotId: string,
    options: SnapshotOptions,
    signal: AbortSignal,
    report: (
      page: number,
      count: number,
      cached: boolean,
      pages: number,
      rate?: number,
      reset?: string,
    ) => void,
  ) {
    const query = `state=${state}&sort=updated&direction=desc&per_page=100`;
    const firstUrl = `/repos/${repository.fullName}/pulls?${query}&page=1`;
    const first = await this.fetchPage(
      firstUrl,
      repository,
      stream,
      '1',
      snapshotId,
      options,
      signal,
    );
    const firstRows = first.rows;
    const nextUrl = first.next;
    const lastUrl = first.last;
    const pages = lastUrl
      ? Number(new URL(lastUrl).searchParams.get('page'))
      : (first.totalPages ?? 0);
    const all = [...firstRows];
    report(1, firstRows.length, first.cached, pages, first.rate, first.reset);
    await options.onPage?.(filterRows(firstRows, scope, state), {
      pages: 1,
      requests: 1,
      count: firstRows.length,
      rateLimitRemaining: first.rate,
      status: first.cached ? 'Reused page 1' : 'Downloaded page 1',
    });
    if (
      scope.kind === 'recent' &&
      state === 'closed' &&
      firstRows.every((row) => isBeforeCutoff(row, scope.cutoffDays))
    )
      return all;
    if (!lastUrl && !pages) {
      let nextPageUrl = nextUrl;
      let page = 2;
      while (nextPageUrl) {
        const response = await this.fetchPage(
          nextPageUrl,
          repository,
          stream,
          String(page),
          snapshotId,
          options,
          signal,
        );
        report(
          page,
          response.rows.length,
          response.cached,
          page,
          response.rate,
          response.reset,
        );
        const filtered = filterRows(response.rows, scope, state);
        await options.onPage?.(filtered, {
          pages: page,
          requests: 1,
          count: all.length + response.rows.length,
          rateLimitRemaining: response.rate,
          status: response.cached
            ? `Reused page ${page}`
            : `Downloaded page ${page}`,
        });
        all.push(...response.rows);
        if (
          scope.kind === 'recent' &&
          state === 'closed' &&
          response.rows.length > 0 &&
          response.rows.every((row) => isBeforeCutoff(row, scope.cutoffDays))
        )
          break;
        nextPageUrl = response.next;
        page++;
      }
      return all;
    }
    const urls = Array.from({ length: Math.max(0, pages - 1) }, (_, index) => {
      const page = index + 2;
      const url = new URL(firstUrl, 'https://api.github.com');
      url.searchParams.set('page', String(page));
      return { page, url: url.href };
    });
    const concurrency = Math.min(
      MAX_CONCURRENCY,
      Math.max(1, options.concurrency ?? MAX_CONCURRENCY),
    );
    for (let index = 0; index < urls.length; index += concurrency) {
      const batch = urls.slice(index, index + concurrency);
      const values = await Promise.all(
        batch.map(async ({ page, url }) => {
          const response = await this.fetchPage(
            url,
            repository,
            stream,
            String(page),
            snapshotId,
            options,
            signal,
          );
          report(
            page,
            response.rows.length,
            response.cached,
            pages,
            response.rate,
            response.reset,
          );
          await options.onPage?.(filterRows(response.rows, scope, state), {
            pages: page,
            requests: 1,
            count: all.length + response.rows.length,
            rateLimitRemaining: response.rate,
            status: response.cached
              ? `Reused page ${page}`
              : `Downloaded page ${page}`,
          });
          return response.rows;
        }),
      );
      all.push(...values.flat());
      if (
        scope.kind === 'recent' &&
        state === 'closed' &&
        all
          .slice(-values.flat().length)
          .every((row) => isBeforeCutoff(row, scope.cutoffDays))
      )
        break;
    }
    return all;
  }

  private async fetchPage(
    url: string,
    repository: Repository,
    stream: string,
    page: string,
    snapshotId: string,
    options: SnapshotOptions,
    signal: AbortSignal,
  ) {
    const scopeKey =
      options.scope?.kind === 'recent'
        ? `recent-${options.scope.cutoffDays}`
        : (options.scope?.kind ?? 'open');
    const key = `${repository.id}|${scopeKey}|${stream}|${page}`;
    const cached = await options.cache?.get(key);
    const response = await this.client.request<unknown>(
      url,
      this.credential,
      signal,
      3,
      cached?.etag,
    );
    let values: GitHubPullRequest[];
    if (response.data === undefined && cached) {
      const fetchedAt = new Date().toISOString();
      return {
        rows: cached.rows.map((row) => ({ ...row, snapshotId, fetchedAt })),
        cached: true,
        link: response.link ?? cached.next,
        next: cached.next,
        last: cached.last,
        totalPages: cached.totalPages,
        rate: response.rateLimitRemaining,
        reset: response.rateLimitResetAt,
      };
    } else {
      if (
        !Array.isArray(response.data) ||
        response.data.some((raw) => !isPullRequestPayload(raw))
      )
        throw new AppError(
          'invalid-response',
          'GitHub returned malformed pull request data.',
        );
      values = response.data as GitHubPullRequest[];
    }
    const rows = values.map((raw) =>
      normalizePullRequest(raw, repository.id, repository.fullName, snapshotId),
    );
    const links = parseLinkHeader(response.link);
    const totalPages = links.last
      ? Number(new URL(links.last).searchParams.get('page'))
      : undefined;
    if (response.headers.get('etag') && options.cache)
      await options.cache.set({
        key,
        etag: response.headers.get('etag')!,
        rows: rows.map((row) => ({ ...row })),
        updatedAt: new Date().toISOString(),
        next: links.next,
        last: links.last,
        totalPages,
      });
    return {
      rows,
      cached: false,
      link: response.link,
      next: links.next,
      last: links.last,
      totalPages,
      rate: response.rateLimitRemaining,
      reset: response.rateLimitResetAt,
    };
  }
}
function isBeforeCutoff(value: { updated_at: string }, cutoffDays: number) {
  return (
    new Date(value.updated_at).valueOf() < Date.now() - cutoffDays * 86400000
  );
}
function filterRows(
  rows: ReturnType<typeof normalizePullRequest>[],
  scope: SnapshotScope,
  state: 'open' | 'closed' | 'all',
) {
  if (scope.kind !== 'recent' || state !== 'closed') return rows;
  const cutoff = Date.now() - scope.cutoffDays * 86400000;
  return rows.filter((row) => new Date(row.updated_at).valueOf() >= cutoff);
}
function isRepositoryPayload(value: unknown): value is {
  id: number;
  full_name: string;
  visibility?: 'public' | 'private' | 'internal';
  default_branch: string;
} {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'number' &&
    typeof item.full_name === 'string' &&
    typeof item.default_branch === 'string' &&
    (item.visibility === undefined ||
      item.visibility === 'public' ||
      item.visibility === 'private' ||
      item.visibility === 'internal')
  );
}
function isPullRequestPayload(value: unknown): value is GitHubPullRequest {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.number === 'number' &&
    typeof item.html_url === 'string' &&
    typeof item.title === 'string' &&
    (item.state === 'open' || item.state === 'closed') &&
    typeof item.base === 'object' &&
    item.base !== null &&
    typeof (item.base as Record<string, unknown>).ref === 'string' &&
    typeof item.head === 'object' &&
    item.head !== null &&
    typeof (item.head as Record<string, unknown>).ref === 'string' &&
    typeof item.created_at === 'string' &&
    typeof item.updated_at === 'string' &&
    'closed_at' in item
  );
}
