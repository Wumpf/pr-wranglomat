import type { CompiledFilter, Literal, QueryAst } from './ast';
export function formatFilter(filter: CompiledFilter): string {
  const expression = formatNode(filter.ast);
  const order = filter.sort.length
    ? ` ORDER BY ${filter.sort.map((x) => `${x.field} ${x.direction}`).join(', ')}`
    : '';
  const limit = filter.limit === undefined ? '' : ` LIMIT ${filter.limit}`;
  return expression + order + limit;
}
function formatNode(node: QueryAst): string {
  if (node.kind === 'binary')
    return `(${formatNode(node.left)} ${node.op} ${formatNode(node.right)})`;
  if (node.kind === 'not') return `NOT ${formatNode(node.expression)}`;
  if (node.kind === 'nullcheck')
    return `${node.field} IS ${node.not ? 'NOT ' : ''}NULL`;
  if (node.kind === 'emptycheck')
    return `${node.field} IS ${node.not ? 'NOT ' : ''}EMPTY`;
  if (node.kind === 'collection')
    return `${node.field} ${node.op} ${list(node.value)}`;
  return `${node.field} ${node.op} ${Array.isArray(node.value) ? list(node.value) : literal(node.value)}`;
}
function list(values: Literal[]) {
  return `[${values.map(literal).join(', ')}]`;
}
function literal(value: Literal): string {
  if (value === null) return 'null';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && !Array.isArray(value)) return value.source;
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return list(value);
  return String(value);
}
