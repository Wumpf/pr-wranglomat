import { describe, expect, it } from 'vitest';
import { parse } from './parser';
import { evaluate } from './evaluate';
import type { PullRequest } from '../domain/pullRequest';
const row = (overrides: Partial<PullRequest> = {}): PullRequest => ({
  repositoryId: 1,
  repo: 'acme/app',
  number: 1,
  url: 'https://github.com/acme/app/pull/1',
  title: 'Fix Crash',
  state: 'open',
  draft: false,
  author: 'alice',
  labels: ['bug'],
  assignees: [],
  requested_reviewers: [],
  requested_teams: [],
  base: 'main',
  head: 'fix',
  milestone: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-10T00:00:00Z',
  closed_at: null,
  merged_at: null,
  fieldCompleteness: Object.fromEntries(
    [
      'repo',
      'number',
      'url',
      'title',
      'state',
      'draft',
      'author',
      'labels',
      'assignees',
      'requested_reviewers',
      'requested_teams',
      'base',
      'head',
      'milestone',
      'created_at',
      'updated_at',
      'closed_at',
      'merged_at',
      'age',
    ].map((x) => [x, true]),
  ),
  sourceUpdatedAt: null,
  fetchedAt: '2024-01-10T00:00:00Z',
  snapshotId: 's',
  ...overrides,
});
describe('query language', () => {
  it('supports all comparison and collection operators', () => {
    for (const expression of [
      'title CONTAINS "crash"',
      'title STARTS WITH "fix"',
      'title ENDS WITH "crash"',
      'state = "OPEN"',
      'state != "closed"',
      'number >= 1',
      'number < 2',
      'state IN ["open"]',
      'state NOT IN ["closed"]',
      'labels ANY ["bug"]',
      'labels ALL ["bug"]',
      'labels NONE ["feature"]',
      'closed_at IS NULL',
      'closed_at IS NOT NULL',
    ])
      expect(parse(expression).diagnostics).toEqual([]);
  });
  it('handles precedence, dates, duration, sort and limit', () => {
    const parsed = parse(
      'state IN ["open", "merged"] AND (labels ANY ["bug"] OR title CONTAINS "crash") ORDER BY number desc LIMIT 1',
    );
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.filter?.requiredFields.has('number')).toBe(true);
    const sorted = parse('state = "open" ORDER BY number desc');
    expect(
      evaluate(sorted.filter!, [row(), row({ number: 2 })]).rows[0].number,
    ).toBe(2);
    expect(parse('updated_at >= 2024-01-01').diagnostics).toEqual([]);
    expect(parse('updated_at = 2024-02-30').filter).toBeUndefined();
    expect(parse('age > 14d').diagnostics).toEqual([]);
  });
  it('keeps unavailable fields unknown and obeys three-valued logic', () => {
    const parsed = parse('labels ANY ["bug"]');
    const unavailable = row({
      fieldCompleteness: { ...row().fieldCompleteness, labels: false },
    });
    const evaluation = evaluate(parsed.filter!, [unavailable]);
    expect(evaluation.unknown).toBe(1);
    expect(evaluation.unavailableFields).toEqual(['labels']);
    const trueOrUnknown = parse('state = "open" OR labels ANY ["feature"]');
    expect(evaluate(trueOrUnknown.filter!, [unavailable]).rows).toHaveLength(1);
    const falseAndUnknown = parse(
      'state = "closed" AND labels ANY ["feature"]',
    );
    expect(evaluate(falseAndUnknown.filter!, [unavailable]).unknown).toBe(0);
  });
  it('requires every requested value for ALL collection comparisons', () => {
    const parsed = parse('labels ALL ["bug", "regression"]');
    expect(
      evaluate(parsed.filter!, [row({ labels: ['bug'] })]).rows,
    ).toHaveLength(0);
    expect(
      evaluate(parsed.filter!, [row({ labels: ['bug', 'regression'] })]).rows,
    ).toHaveLength(1);
  });
  it('rejects invalid types and complexity', () => {
    expect(parse('number CONTAINS "1"').filter).toBeUndefined();
    expect(parse('labels = "bug"').filter).toBeUndefined();
    expect(
      parse('labels ANY [' + '"x",'.repeat(100) + ']').diagnostics.length,
    ).toBeGreaterThan(0);
  });
  it('reports malformed syntax with line and column', () => {
    const result = parse('state =\n');
    expect(result.diagnostics[0].line).toBe(2);
    expect(result.diagnostics[0].column).toBe(1);
  });
});
