import type { Credential } from '../ingestion/source';
import { GitHubClient } from './client';
let current: Credential | undefined;
let identity:
  | { login: string; rateLimitRemaining?: number; rateLimitResetAt?: string }
  | undefined;
export const auth = {
  setToken(token: string) {
    const value = token.trim();
    if (!value) throw new Error('Token cannot be empty');
    current = Object.freeze({ kind: 'pat' as const, token: value });
    identity = undefined;
  },
  async validate(signal?: AbortSignal) {
    if (!current) throw new Error('Paste a GitHub token first.');
    const client = new GitHubClient();
    const user = await client.request<{ login: string }>(
      '/user',
      current,
      signal,
    );
    const limit = await client.request<{
      rate: { remaining: number; reset: number };
    }>('/rate_limit', current, signal);
    if (!user.data || typeof user.data.login !== 'string' || !limit.data?.rate)
      throw new Error('GitHub returned an invalid authentication response.');
    identity = {
      login: user.data.login,
      rateLimitRemaining: limit.data.rate.remaining,
      rateLimitResetAt: new Date(limit.data.rate.reset * 1000).toISOString(),
    };
    return identity;
  },
  forget() {
    current = undefined;
    identity = undefined;
  },
  get credential(): Credential | undefined {
    return current;
  },
  get configured() {
    return Boolean(current);
  },
  get identity() {
    return identity;
  },
};
