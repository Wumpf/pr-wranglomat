import { normalizePullRequest } from '../domain/normalize';
import type {
  Credential,
  PullRequestSource,
  SnapshotOptions,
} from '../ingestion/source';
import { normalizeRepoInput, type Repository } from '../domain/repository';
import type { SnapshotResult, SyncProgress } from '../domain/snapshot';
import { AppError } from '../domain/errors';
import type { ReviewActivityState } from '../domain/pullRequest';

interface GraphQLPage {
  repository: {
    pullRequests: {
      nodes: unknown[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };
  rateLimit?: { cost: number; remaining: number; resetAt: string };
}
interface GraphQLResponse {
  data?: GraphQLPage;
  errors?: Array<{ type?: string; message?: string }>;
  extensions?: {
    cost?: {
      requestedQueryCost?: number;
      actualQueryCost?: number;
      throttleStatus?: { remaining: number; resetAt: string };
    };
  };
}
const query = `query PullRequests($owner:String!, $name:String!, $states:[PullRequestState!], $cursor:String) {
  repository(owner:$owner, name:$name) {
    pullRequests(first:100, after:$cursor, states:$states, orderBy:{field:UPDATED_AT,direction:DESC}) {
      nodes { number url title state reviewDecision isDraft author { login } labels(first:100) { nodes { name } pageInfo { hasNextPage } } assignees(first:100) { nodes { login } pageInfo { hasNextPage } } reviewRequests(first:100) { nodes { requestedReviewer { ... on User { login } ... on Team { name } } } pageInfo { hasNextPage } } reviews(first:100, states:[APPROVED,CHANGES_REQUESTED,COMMENTED,DISMISSED]) { nodes { author { login } state } pageInfo { hasNextPage } } baseRefName headRefName createdAt updatedAt closedAt mergedAt milestone { title } }
      pageInfo { hasNextPage endCursor }
    }
  }
  rateLimit { cost remaining resetAt }
}`;
const repoQuery = `query Repo($owner:String!, $name:String!) { repository(owner:$owner,name:$name) { databaseId nameWithOwner defaultBranchRef { name } visibility } }`;

export class GraphQLSource implements PullRequestSource {
  // Shared by all repository workers in a refresh batch.
  private blockedUntil = 0;
  private async waitForBudget(signal?: AbortSignal) {
    while (this.blockedUntil > Date.now())
      await delay(this.blockedUntil - Date.now(), signal);
  }
  private async pause(
    response: Response,
    resetAt: string | undefined,
    signal: AbortSignal | undefined,
    attempt: number,
  ) {
    this.blockedUntil = Math.max(
      this.blockedUntil,
      Date.now() + retryDelay(response, resetAt, attempt),
    );
    await this.waitForBudget(signal);
  }
  constructor(
    private readonly origin = 'https://api.github.com/graphql',
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
    private readonly credential?: Credential,
  ) {}
  async validateCredential(signal?: AbortSignal) {
    const response = await this.request<{
      data?: {
        viewer?: { login?: string };
        rateLimit?: { remaining: number; resetAt: string };
      };
    }>(
      'query Viewer { viewer { login } rateLimit { remaining resetAt } }',
      {},
      this.credential,
      signal,
    );
    const login = response.data?.viewer?.login;
    const rate = response.data?.rateLimit;
    if (typeof login !== 'string' || !rate)
      throw new AppError(
        'invalid-response',
        'GitHub returned an invalid authentication response.',
      );
    return {
      login,
      rateLimitRemaining: rate.remaining,
      rateLimitResetAt: rate.resetAt,
    };
  }
  async resolveRepository(
    input: string,
    credential?: Credential,
    signal?: AbortSignal,
  ): Promise<Repository> {
    const parts = normalizeRepoInput(input).split('/');
    const body = await this.request<GraphQLResponse>(
      repoQuery,
      { owner: parts[0], name: parts[1] },
      credential,
      signal,
    );
    const repo = (
      body.data as unknown as {
        repository?: {
          databaseId?: number;
          nameWithOwner?: string;
          defaultBranchRef?: { name?: string };
          visibility?: string;
        };
      }
    )?.repository;
    if (
      !repo?.databaseId ||
      !repo.nameWithOwner ||
      !repo.defaultBranchRef?.name
    )
      throw new AppError(
        'invalid-response',
        'GitHub returned malformed repository data.',
      );
    return {
      id: repo.databaseId,
      fullName: repo.nameWithOwner,
      visibility:
        repo.visibility === 'PRIVATE'
          ? 'private'
          : repo.visibility === 'INTERNAL'
            ? 'internal'
            : 'public',
      defaultBranch: repo.defaultBranchRef.name,
      lastSyncStatus: 'never',
      snapshotScope: { kind: 'open' },
    };
  }
  async createSnapshot(
    repository: Repository,
    options: SnapshotOptions,
    onProgress: (progress: SyncProgress) => void,
    signal: AbortSignal,
  ): Promise<SnapshotResult> {
    const scope = options.scope ?? { kind: 'open' as const };
    const [owner, name] = repository.fullName.split('/');
    const streams =
      scope.kind === 'open'
        ? [{ states: ['OPEN'], stopAtCutoff: false }]
        : scope.kind === 'recent'
          ? [
              { states: ['OPEN'], stopAtCutoff: false },
              { states: ['CLOSED', 'MERGED'], stopAtCutoff: true },
            ]
          : [
              {
                states: ['OPEN', 'CLOSED', 'MERGED'],
                stopAtCutoff: false,
              },
            ];
    const rows: ReturnType<typeof normalizePullRequest>[] = [];
    const seen = new Set<number>();
    let pages = 0;
    let requests = 0;
    let remaining: number | undefined;
    let resetAt: string | undefined;
    let cost = 0;
    const fieldCompleteness = {
      review_state: true,
      labels: true,
      assignees: true,
      requested_reviewers: true,
      requested_teams: true,
      reviewed_by: true,
    };
    const snapshotId = options.snapshotId ?? crypto.randomUUID();
    const cutoff =
      scope.kind === 'recent' ? Date.now() - scope.cutoffDays * 86400000 : 0;

    // At most one page write overlaps the next request. Always drain before
    // returning/throwing so cancellation cannot race snapshot cleanup.
    let pendingWrite: Promise<{ error: unknown } | undefined> | undefined;
    const drainWrite = async () => {
      const result = await pendingWrite;
      pendingWrite = undefined;
      if (result) throw result.error;
    };
    try {
      for (const stream of streams) {
        let cursor: string | null = null;
        let hasNext = true;
        while (hasNext) {
          const response: GraphQLResponse = await this.request<GraphQLResponse>(
            query,
            { owner, name, states: stream.states, cursor },
            this.credential,
            signal,
          );
          const pageData:
            GraphQLPage['repository']['pullRequests'] | undefined =
            response.data?.repository?.pullRequests;
          if (!pageData || !Array.isArray(pageData.nodes) || !pageData.pageInfo)
            throw new AppError(
              'invalid-response',
              'GitHub returned malformed GraphQL data.',
            );
          const normalized: ReturnType<typeof normalizePullRequest>[] =
            pageData.nodes.map((node: unknown) =>
              this.normalizeNode(node, repository, snapshotId),
            );
          const staged = normalized.filter(
            (row) =>
              !stream.stopAtCutoff ||
              new Date(row.updated_at).valueOf() >= cutoff,
          );
          const accepted: typeof staged = [];
          for (const row of staged) {
            if (!seen.has(row.number)) {
              seen.add(row.number);
              rows.push(row);
              accepted.push(row);
            }
            for (const field of Object.keys(fieldCompleteness) as Array<
              keyof typeof fieldCompleteness
            >)
              fieldCompleteness[field] &&= Boolean(
                row.fieldCompleteness[field],
              );
          }
          pages++;
          requests++;
          hasNext = pageData.pageInfo.hasNextPage;
          cursor = pageData.pageInfo.endCursor;
          const rate = response.data?.rateLimit;
          remaining = rate?.remaining ?? remaining;
          resetAt = rate?.resetAt ?? resetAt;
          cost += rate?.cost ?? response.extensions?.cost?.actualQueryCost ?? 0;
          const progress = {
            pages,
            requests,
            count: rows.length,
            rateLimitRemaining: remaining,
            rateLimitResetAt: resetAt,
            rateLimitCost: cost,
            status: `Downloaded GraphQL page ${pages}`,
          };
          onProgress(progress);
          await drainWrite();
          pendingWrite = Promise.resolve()
            .then(() => options.onPage?.(accepted, progress))
            .then(
              () => undefined,
              (error: unknown) => ({ error }),
            );
          if (
            stream.stopAtCutoff &&
            normalized.length > 0 &&
            normalized.every(
              (row) => new Date(row.updated_at).valueOf() < cutoff,
            )
          )
            break;
          if (!cursor && hasNext)
            throw new AppError(
              'invalid-response',
              'GraphQL pagination returned no cursor.',
            );
        }
      }
    } finally {
      await drainWrite();
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
        source: 'github-graphql',
        completeness: { core: true, ...fieldCompleteness },
        count: rows.length,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        scope,
        historyComplete: scope.kind === 'complete',
        requestCount: requests,
        rateLimitRemaining: remaining,
        rateLimitResetAt: resetAt,
        rateLimitCost: cost,
      },
      pullRequests: rows,
    };
  }
  private normalizeNode(
    node: unknown,
    repository: Repository,
    snapshotId: string,
  ) {
    if (!node || typeof node !== 'object')
      throw new AppError(
        'invalid-response',
        'GraphQL returned malformed pull request data.',
      );
    const item = node as Record<string, unknown>;
    const author =
      item.author && typeof item.author === 'object'
        ? (item.author as { login?: unknown }).login
        : undefined;
    const connection = (key: string) =>
      item[key] && typeof item[key] === 'object'
        ? (item[key] as {
            nodes?: unknown[];
            pageInfo?: { hasNextPage?: boolean };
          })
        : undefined;
    const labels = connection('labels');
    const assignees = connection('assignees');
    const reviewRequests = connection('reviewRequests');
    const reviews = connection('reviews');
    if (
      typeof item.number !== 'number' ||
      typeof item.url !== 'string' ||
      typeof item.title !== 'string' ||
      !['OPEN', 'CLOSED', 'MERGED'].includes(String(item.state)) ||
      (item.reviewDecision !== null &&
        !['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED'].includes(
          String(item.reviewDecision),
        )) ||
      typeof item.createdAt !== 'string' ||
      typeof item.updatedAt !== 'string' ||
      !labels?.nodes ||
      !assignees?.nodes ||
      !reviewRequests?.nodes ||
      !reviews?.nodes
    )
      throw new AppError(
        'invalid-response',
        'GraphQL returned malformed pull request data.',
      );
    const requestedReviewers = reviewRequests.nodes.reduce<{
      users: string[];
      teams: string[];
    }>(
      (result, value) => {
        const requested =
          value && typeof value === 'object'
            ? (value as { requestedReviewer?: Record<string, unknown> })
                .requestedReviewer
            : undefined;
        if (requested?.login) result.users.push(String(requested.login));
        if (requested?.name) result.teams.push(String(requested.name));
        return result;
      },
      { users: [], teams: [] },
    );
    const reviewActivity = new Map<string, Set<ReviewActivityState>>();
    const reviewStates: Record<string, ReviewActivityState> = {
      APPROVED: 'approved',
      CHANGES_REQUESTED: 'changes_requested',
      COMMENTED: 'commented',
      DISMISSED: 'dismissed',
    };
    for (const value of reviews.nodes) {
      if (!value || typeof value !== 'object') continue;
      const review = value as {
        author?: { login?: unknown };
        state?: unknown;
      };
      if (!review.author?.login) continue;
      const login = String(review.author.login);
      const states =
        reviewActivity.get(login) ?? new Set<ReviewActivityState>();
      const state = reviewStates[String(review.state)];
      if (state) states.add(state);
      reviewActivity.set(login, states);
    }
    const reviewedBy = [...reviewActivity.keys()];
    const complete = (value: { pageInfo?: { hasNextPage?: boolean } }) =>
      !value.pageInfo?.hasNextPage;
    const reviewState =
      item.reviewDecision === 'APPROVED'
        ? 'approved'
        : item.reviewDecision === 'CHANGES_REQUESTED'
          ? 'changes_requested'
          : item.reviewDecision === 'REVIEW_REQUIRED'
            ? 'review_required'
            : null;
    return normalizePullRequest(
      {
        number: item.number,
        html_url: item.url,
        title: item.title,
        state: item.state === 'OPEN' ? 'open' : 'closed',
        review_state: reviewState,
        draft: Boolean(item.isDraft),
        user: author ? { login: String(author) } : null,
        labels: labels.nodes.map((value) => ({
          name: String((value as { name?: unknown }).name ?? ''),
        })),
        assignees: assignees.nodes.map((value) => ({
          login: String((value as { login?: unknown }).login ?? ''),
        })),
        requested_reviewers: requestedReviewers.users.map((login) => ({
          login,
        })),
        requested_teams: requestedReviewers.teams.map((name) => ({ name })),
        reviewed_by: reviewedBy.map((login) => ({ login })),
        review_activity: [...reviewActivity].map(([login, states]) => ({
          login,
          states: [...states],
        })),
        requested_reviewers_complete: complete(reviewRequests),
        requested_teams_complete: complete(reviewRequests),
        reviewed_by_complete: complete(reviews),
        labels_complete: complete(labels),
        assignees_complete: complete(assignees),
        base: { ref: String(item.baseRefName ?? '') },
        head: { ref: String(item.headRefName ?? '') },
        created_at: item.createdAt,
        updated_at: item.updatedAt,
        closed_at: typeof item.closedAt === 'string' ? item.closedAt : null,
        merged_at: typeof item.mergedAt === 'string' ? item.mergedAt : null,
        milestone:
          item.milestone && typeof item.milestone === 'object'
            ? {
                title: String(
                  (item.milestone as { title?: unknown }).title ?? '',
                ),
              }
            : null,
      },
      repository.id,
      repository.fullName,
      snapshotId,
    );
  }
  private async request<
    T extends { data?: unknown; errors?: GraphQLResponse['errors'] },
  >(
    queryText: string,
    variables: Record<string, unknown>,
    credential?: Credential,
    signal?: AbortSignal,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.waitForBudget(signal);
        if (signal?.aborted)
          throw new AppError('cancelled', 'Refresh cancelled.');
        const response = await this.fetcher(this.origin, {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            ...(credential
              ? { Authorization: `Bearer ${credential.token}` }
              : {}),
          },
          body: JSON.stringify({ query: queryText, variables }),
          signal,
        });
        const reset = response.headers.get('x-ratelimit-reset');
        const resetAt =
          reset && /^\d+$/.test(reset)
            ? new Date(Number(reset) * 1000).toISOString()
            : undefined;
        if (!response.ok) {
          if (
            (response.status === 403 || response.status === 429) &&
            attempt < 2
          ) {
            await this.pause(response, resetAt, signal, attempt);
            continue;
          }
          throw new AppError(
            response.status === 401
              ? 'unauthorized'
              : response.status === 403 || response.status === 429
                ? 'rate-limited'
                : 'network',
            response.status === 403 || response.status === 429
              ? 'GitHub GraphQL rate limit exceeded.'
              : 'GitHub GraphQL request failed.',
          );
        }
        const body = (await response.json()) as T;
        const rateError = body.errors?.some(
          (error) =>
            /rate|limit|throttl/i.test(error.type ?? '') ||
            /rate|limit|throttl/i.test(error.message ?? ''),
        );
        if (rateError && attempt < 2) {
          await this.pause(response, resetAt, signal, attempt);
          continue;
        }
        if (body.errors?.length)
          throw new AppError(
            rateError ? 'rate-limited' : 'network',
            rateError
              ? 'GitHub GraphQL rate limit exceeded.'
              : 'GitHub GraphQL request failed.',
          );
        const rate = (body.data as GraphQLPage | undefined)?.rateLimit;
        if (rate?.remaining === 0 && Number.isFinite(Date.parse(rate.resetAt)))
          this.blockedUntil = Math.max(
            this.blockedUntil,
            Date.parse(rate.resetAt),
          );
        return body;
      } catch (error) {
        if (
          signal?.aborted ||
          (error instanceof DOMException && error.name === 'AbortError')
        )
          throw new AppError('cancelled', 'Refresh cancelled.');
        if (error instanceof AppError && error.code !== 'network') throw error;
        if (attempt === 2)
          throw error instanceof AppError
            ? error
            : new AppError('network', 'Unable to reach GitHub.');
        await delay(
          250 * 2 ** attempt + Math.floor(Math.random() * 100),
          signal,
        );
      }
    }
    throw new AppError('network', 'Unable to reach GitHub.');
  }
}
function retryDelay(
  response: Response,
  resetAt: string | undefined,
  attempt: number,
) {
  const retry = Number(response.headers.get('retry-after') ?? '');
  const resetWait = resetAt
    ? Math.max(0, (new Date(resetAt).valueOf() - Date.now()) / 1000)
    : 0;
  return Math.min(
    300_000,
    (Number.isFinite(retry) && retry > 0
      ? retry * 1000
      : resetWait * 1000 || 250 * 2 ** attempt) +
      Math.floor(Math.random() * 100),
  );
}
function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AppError('cancelled', 'Refresh cancelled.'));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(new AppError('cancelled', 'Refresh cancelled.'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
