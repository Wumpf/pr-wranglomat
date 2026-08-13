import { expect, it } from 'vitest';
import { normalizePullRequest } from './normalize';
it('normalizes merged state and filterable fields', () => {
  const pr = normalizePullRequest(
    {
      number: 1,
      html_url: 'u',
      title: 'T',
      state: 'closed',
      draft: false,
      user: { login: 'a' },
      labels: [{ name: 'bug' }],
      assignees: [],
      requested_reviewers: [],
      requested_teams: [],
      base: { ref: 'main' },
      head: { ref: 'feature' },
      milestone: null,
      created_at: '2020-01-01',
      updated_at: '2020-01-02',
      closed_at: '2020-01-03',
      merged_at: '2020-01-04',
    },
    1,
    'o/r',
    's',
  );
  expect(pr.state).toBe('merged');
  expect(pr.labels).toEqual(['bug']);
});
