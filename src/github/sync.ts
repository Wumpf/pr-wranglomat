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
import type { SnapshotResult, SyncProgress } from '../domain/snapshot';
import { AppError } from '../domain/errors';
import { parseLinkHeader } from './links';

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
    };
  }
  async createSnapshot(
    repository: Repository,
    options: SnapshotOptions,
    onProgress: (p: SyncProgress) => void,
    signal: AbortSignal,
  ): Promise<SnapshotResult> {
    const snapshotId = options.snapshotId ?? crypto.randomUUID();
    const rows: ReturnType<typeof normalizePullRequest>[] = [];
    let page = 1;
    let nextPath: string | undefined;
    let requests = 0;
    let remaining: number | undefined;
    let resetAt: string | undefined;
    const startedAt = new Date().toISOString();
    try {
      while (true) {
        const result = await this.client.request<unknown>(
          nextPath ??
            `/repos/${repository.fullName}/pulls?state=all&per_page=100&page=${page}`,
          this.credential,
          signal,
        );
        requests += 1;
        remaining = result.rateLimitRemaining;
        resetAt = result.rateLimitResetAt;
        if (
          !Array.isArray(result.data) ||
          result.data.some((raw) => !isPullRequestPayload(raw))
        )
          throw new AppError(
            'invalid-response',
            'GitHub returned malformed pull request data.',
          );
        const values = (result.data as GitHubPullRequest[]).map((raw) =>
          normalizePullRequest(
            raw,
            repository.id,
            repository.fullName,
            snapshotId,
          ),
        );
        const seen = new Set(rows.map((x) => x.number));
        const pageRows = values.filter((x) => !seen.has(x.number));
        rows.push(...pageRows);
        onProgress({
          pages: page,
          requests,
          count: rows.length,
          rateLimitRemaining: remaining,
          status: `Downloaded page ${page}`,
        });
        await options.onPage?.(pageRows, {
          pages: page,
          requests,
          count: rows.length,
          rateLimitRemaining: remaining,
          status: `Downloaded page ${page}`,
        });
        nextPath = parseLinkHeader(result.link)?.next;
        if (!nextPath) break;
        page += 1;
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('network', 'Refresh failed.');
    }
    const snapshot = {
      id: snapshotId,
      repositoryId: repository.id,
      state: 'complete' as const,
      schemaVersion: 1 as const,
      profile: 'core' as const,
      source: 'github-rest' as const,
      completeness: { core: true },
      count: rows.length,
      startedAt,
      finishedAt: new Date().toISOString(),
      requestCount: requests,
      rateLimitRemaining: remaining,
      rateLimitResetAt: resetAt,
    };
    return { snapshot, pullRequests: rows };
  }
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
