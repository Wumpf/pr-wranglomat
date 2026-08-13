import { expect, it } from 'vitest';
import { parse } from './parser';
import { evaluate } from './evaluate';
import type { PullRequest } from '../domain/pullRequest';
it('evaluates 10,000 records without dynamic code', () => {
  const filter = parse('state = "open" AND draft = false').filter!;
  const rows = Array.from(
    { length: 10000 },
    (_, number) =>
      ({
        repositoryId: 1,
        repo: 'o/r',
        number,
        url: '',
        title: `PR ${number}`,
        state: 'open',
        review_state: null,
        draft: false,
        author: 'a',
        labels: [],
        assignees: [],
        requested_reviewers: [],
        requested_teams: [],
        base: 'main',
        head: 'head',
        milestone: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        closed_at: null,
        merged_at: null,
        fieldCompleteness: { state: true, draft: true },
        sourceUpdatedAt: null,
        fetchedAt: '',
        snapshotId: 's',
      }) satisfies PullRequest,
  );
  const start = performance.now();
  expect(evaluate(filter, rows).rows).toHaveLength(10000);
  expect(performance.now() - start).toBeLessThan(200);
});
