import type { Credential } from '../ingestion/source';
import { GraphQLSource } from './graphql';
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
    identity = await new GraphQLSource(
      undefined,
      undefined,
      current,
    ).validateCredential(signal);
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
