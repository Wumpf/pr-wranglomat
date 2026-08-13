import type { Diagnostic, Literal, QueryAst } from './ast';
const collectionFields = new Set([
  'labels',
  'assignees',
  'requested_reviewers',
  'requested_teams',
]);
const booleanFields = new Set(['draft']);
const numericFields = new Set(['number']);
const dateFields = new Set([
  'created_at',
  'updated_at',
  'closed_at',
  'merged_at',
]);
const stringFields = new Set([
  'repo',
  'url',
  'title',
  'state',
  'review_state',
  'author',
  'base',
  'head',
  'milestone',
]);
export function validateTypes(node: QueryAst, diagnostics: Diagnostic[]) {
  if (node.kind === 'binary') {
    validateTypes(node.left, diagnostics);
    validateTypes(node.right, diagnostics);
    return;
  }
  if (node.kind === 'not') {
    validateTypes(node.expression, diagnostics);
    return;
  }
  if (node.kind === 'nullcheck') {
    if (
      !collectionFields.has(node.field) &&
      !booleanFields.has(node.field) &&
      !numericFields.has(node.field) &&
      !dateFields.has(node.field) &&
      !stringFields.has(node.field) &&
      node.field !== 'age'
    )
      diagnostics.push(diag(`Unknown field '${node.field}'`, node));
    return;
  }
  if (node.kind === 'collection') {
    if (!collectionFields.has(node.field))
      diagnostics.push(diag(`${node.field} is not a collection field`, node));
    if (node.value.some((value) => typeof value !== 'string'))
      diagnostics.push(
        diag(`${node.field} collection values must be strings`, node),
      );
    return;
  }
  const values = Array.isArray(node.value) ? node.value : [node.value];
  if (collectionFields.has(node.field))
    diagnostics.push(diag(`${node.field} needs ANY, ALL, or NONE`, node));
  if (
    node.field === 'age' &&
    !['=', '!=', '<', '<=', '>', '>=', 'IN', 'NOT IN'].includes(node.op)
  )
    diagnostics.push(
      diag('age supports ordering, equality, and IN only', node),
    );
  if (
    booleanFields.has(node.field) &&
    !['=', '!=', 'IN', 'NOT IN'].includes(node.op)
  )
    diagnostics.push(diag(`${node.field} supports equality and IN only`, node));
  if (
    (numericFields.has(node.field) || dateFields.has(node.field)) &&
    !['=', '!=', '<', '<=', '>', '>=', 'IN', 'NOT IN'].includes(node.op)
  )
    diagnostics.push(
      diag(`${node.field} does not support text operators`, node),
    );
  if (
    !collectionFields.has(node.field) &&
    !stringFields.has(node.field) &&
    !booleanFields.has(node.field) &&
    !numericFields.has(node.field) &&
    !dateFields.has(node.field) &&
    node.field !== 'age'
  )
    diagnostics.push(diag(`Unknown field '${node.field}'`, node));
  const bad = (test: (value: Literal) => boolean, message: string) => {
    if (values.some(test)) diagnostics.push(diag(message, node));
  };
  if (booleanFields.has(node.field))
    bad(
      (v) => typeof v !== 'boolean' && v !== null,
      `${node.field} expects a boolean`,
    );
  if (numericFields.has(node.field))
    bad(
      (v) => typeof v !== 'number' && v !== null,
      `${node.field} expects a number`,
    );
  if (dateFields.has(node.field))
    bad(
      (v) => !(v instanceof Date) && v !== null,
      `${node.field} expects an ISO date`,
    );
  if (stringFields.has(node.field))
    bad(
      (v) => typeof v !== 'string' && v !== null,
      `${node.field} expects text`,
    );
  if (node.field === 'age')
    bad((v) => !isDuration(v) && v !== null, 'age expects a duration');
  if (['CONTAINS', 'STARTS WITH', 'ENDS WITH'].includes(node.op))
    bad((v) => typeof v !== 'string', `${node.op} expects text`);
  if (
    ![
      '=',
      '!=',
      '<',
      '<=',
      '>',
      '>=',
      'IN',
      'NOT IN',
      'CONTAINS',
      'STARTS WITH',
      'ENDS WITH',
    ].includes(node.op)
  )
    diagnostics.push(diag(`Unsupported operator ${node.op}`, node));
}
function isDuration(value: Literal): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'kind' in value &&
    value.kind === 'duration'
  );
}
function diag(message: string, node: QueryAst): Diagnostic {
  return { message, start: node.start, end: node.end };
}
export function literalType(value: Literal) {
  return value === null
    ? 'null'
    : Array.isArray(value)
      ? 'list'
      : value instanceof Date
        ? 'date'
        : typeof value;
}
