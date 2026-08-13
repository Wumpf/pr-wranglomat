import { AppError } from '../domain/errors';
import { githubError } from './errors';
import type { Credential } from '../ingestion/source';
export interface GitHubResponse<T> {
  data: T;
  headers: Headers;
  link?: string;
  rateLimitRemaining?: number;
  rateLimitResetAt?: string;
  requestCount?: number;
}
export class GitHubClient {
  constructor(
    private readonly origin = 'https://api.github.com',
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}
  async request<T>(
    path: string,
    credential?: Credential,
    signal?: AbortSignal,
    attempts = 3,
  ): Promise<GitHubResponse<T>> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const requestUrl = new URL(path, this.origin);
        if (requestUrl.origin !== new URL(this.origin).origin)
          throw new AppError(
            'invalid-response',
            'GitHub pagination returned an unexpected origin.',
          );
        const response = await this.fetcher(requestUrl.href, {
          headers: {
            Accept: 'application/vnd.github+json',
            ...(credential
              ? { Authorization: `Bearer ${credential.token}` }
              : {}),
          },
          signal,
        });
        const remainingHeader = response.headers.get('x-ratelimit-remaining');
        const remaining =
          remainingHeader === null ? undefined : Number(remainingHeader);
        const resetHeader = response.headers.get('x-ratelimit-reset');
        const resetAt =
          resetHeader && /^\d+$/.test(resetHeader)
            ? new Date(Number(resetHeader) * 1000).toISOString()
            : undefined;
        if (!response.ok) {
          const retryHeader = response.headers.get('retry-after');
          const resetWait = resetAt
            ? Math.max(
                0,
                Math.min(
                  300,
                  (new Date(resetAt).valueOf() - Date.now()) / 1000,
                ),
              )
            : undefined;
          const retry =
            retryHeader && /^\d+(\.\d+)?$/.test(retryHeader)
              ? Math.min(Number(retryHeader), 300)
              : resetWait;
          const error = githubError(response.status, '', retry, remaining);
          if (
            (error.code === 'network' || error.code === 'rate-limited') &&
            attempt + 1 < attempts
          ) {
            const jitter = Math.floor(Math.random() * 100);
            await delay(
              Math.min(
                300_000,
                (retry ? retry * 1000 : 250 * 2 ** attempt) + jitter,
              ),
              signal,
            );
            continue;
          }
          throw error;
        }
        let data: unknown;
        try {
          data = await response.json();
        } catch {
          throw new AppError(
            'invalid-response',
            'GitHub returned malformed JSON.',
          );
        }
        return {
          data: data as T,
          headers: response.headers,
          link: response.headers.get('link') ?? undefined,
          rateLimitRemaining: remaining,
          rateLimitResetAt: resetAt,
          requestCount: 1,
        };
      } catch (error) {
        if (signal?.aborted)
          throw new AppError('cancelled', 'Refresh cancelled.');
        if (error instanceof AppError && error.code !== 'network') throw error;
        if (attempt + 1 === attempts)
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
function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new AppError('cancelled', 'Refresh cancelled.'));
      },
      { once: true },
    );
  });
}
