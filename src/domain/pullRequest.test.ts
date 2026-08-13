import { describe, expect, it } from 'vitest';
import { pullRequestStatus } from './pullRequest';

describe('pullRequestStatus', () => {
  it('shows an open draft as draft', () => {
    expect(pullRequestStatus({ state: 'open', draft: true })).toBe('draft');
  });

  it.each(['open', 'closed', 'merged'] as const)(
    'keeps the %s lifecycle state for a non-draft PR',
    (state) => {
      expect(pullRequestStatus({ state, draft: false })).toBe(state);
    },
  );

  it('gives a closed lifecycle state precedence over the draft flag', () => {
    expect(pullRequestStatus({ state: 'closed', draft: true })).toBe('closed');
  });
});
