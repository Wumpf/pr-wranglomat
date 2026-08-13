import type { PullRequest, TriState } from '../domain/pullRequest';
import type { CompiledFilter, QueryAst, Duration } from './ast';
export interface Evaluation {
  rows: PullRequest[];
  unknown: number;
  unavailableFields: string[];
}
export function evaluate(
  filter: CompiledFilter,
  records: PullRequest[],
  evaluationTime = new Date(),
): Evaluation {
  let unknown = 0;
  const matched = records.filter((row) => {
    const result = evalNode(filter.ast, row, evaluationTime);
    if (result === 'unknown') unknown++;
    return result === true;
  });
  if (filter.sort.length)
    matched.sort((a, b) => {
      for (const clause of filter.sort) {
        const av = isAvailable(a, clause.field)
          ? value(a, clause.field, evaluationTime)
          : null;
        const bv = isAvailable(b, clause.field)
          ? value(b, clause.field, evaluationTime)
          : null;
        if (av === bv) continue;
        const order = av == null ? 1 : bv == null ? -1 : av < bv ? -1 : 1;
        return clause.direction === 'ASC' ? order : -order;
      }
      return a.number - b.number;
    });
  const unavailableFields = [...filter.requiredFields].filter((field) =>
    records.some((row) => !isAvailable(row, field)),
  );
  return {
    rows: filter.limit === undefined ? matched : matched.slice(0, filter.limit),
    unknown,
    unavailableFields,
  };
}
function evalNode(node: QueryAst, row: PullRequest, now: Date): TriState {
  if (node.kind === 'binary') {
    const left = evalNode(node.left, row, now);
    const right = evalNode(node.right, row, now);
    if (node.op === 'AND')
      return left === false || right === false
        ? false
        : left === 'unknown' || right === 'unknown'
          ? 'unknown'
          : true;
    return left === true || right === true
      ? true
      : left === 'unknown' || right === 'unknown'
        ? 'unknown'
        : false;
  }
  if (node.kind === 'not') {
    const result = evalNode(node.expression, row, now);
    return result === 'unknown' ? result : !result;
  }
  if (!isAvailable(row, node.field)) return 'unknown';
  const actual = value(row, node.field, now);
  if (node.kind === 'nullcheck')
    return node.not
      ? actual !== null && actual !== undefined
      : actual === null || actual === undefined;
  if (node.kind === 'emptycheck') {
    if (!Array.isArray(actual)) return 'unknown';
    return node.not ? 0 < actual.length : actual.length === 0;
  }
  const expected = node.value;
  if (node.kind === 'collection') {
    if (!Array.isArray(actual) || !Array.isArray(expected)) return 'unknown';
    const includes = (target: unknown) =>
      actual.some((item) => compare(item, target, '='));
    if (node.op === 'ANY') return expected.some(includes);
    if (node.op === 'ALL') return expected.every(includes);
    return !expected.some(includes);
  }
  if (node.op === 'IN' || node.op === 'NOT IN') {
    if (!Array.isArray(expected)) return 'unknown';
    const result = expected.some((target) => compare(actual, target, '='));
    return node.op === 'IN' ? result : !result;
  }
  return compare(actual, expected, node.op);
}
function isAvailable(row: PullRequest, field: string): boolean {
  return field === 'age'
    ? Boolean(row.fieldCompleteness.updated_at)
    : Boolean(row.fieldCompleteness[field]);
}
function value(row: PullRequest, field: string, now: Date): unknown {
  if (field === 'age')
    return now.valueOf() - new Date(row.updated_at).valueOf();
  return row[field as keyof PullRequest];
}
function compare(actual: unknown, expected: unknown, op: string): boolean {
  if (actual == null || expected == null)
    return op === '='
      ? actual === expected
      : op === '!='
        ? actual !== expected
        : false;
  if (typeof actual === 'string' && typeof expected === 'string') {
    const a = actual.toLocaleLowerCase();
    const b = expected.toLocaleLowerCase();
    if (op === 'CONTAINS') return a.includes(b);
    if (op === 'STARTS WITH') return a.startsWith(b);
    if (op === 'ENDS WITH') return a.endsWith(b);
    if (op === '=') return a === b;
    if (op === '!=') return a !== b;
    return false;
  }
  const av =
    actual instanceof Date
      ? actual.valueOf()
      : typeof actual === 'object' && actual && 'kind' in actual
        ? (actual as Duration).milliseconds
        : typeof actual === 'string' && /^\d{4}-/.test(actual)
          ? new Date(actual).valueOf()
          : (actual as number);
  const ev =
    expected instanceof Date
      ? expected.valueOf()
      : typeof expected === 'object' && expected && 'kind' in expected
        ? (expected as Duration).milliseconds
        : (expected as number);
  if (op === '=') return av === ev;
  if (op === '!=') return av !== ev;
  if (op === '<') return av < ev;
  if (op === '<=') return av <= ev;
  if (op === '>') return av > ev;
  if (op === '>=') return av >= ev;
  return false;
}
