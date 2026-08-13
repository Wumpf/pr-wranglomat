import type {
  CompiledFilter,
  Diagnostic,
  Duration,
  Literal,
  QueryAst,
  SortClause,
} from './ast';
import { lex, type Token } from './lexer';
import { validateTypes } from './typecheck';
const fields = new Set([
  'repo',
  'number',
  'url',
  'title',
  'state',
  'review_state',
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
]);
const MAX_DEPTH = 100;
const MAX_LIST = 100;
const MAX_SORT = 20;
export function parse(source: string): {
  filter?: CompiledFilter;
  diagnostics: Diagnostic[];
} {
  if (!source.trim()) return { diagnostics: [] };
  try {
    const p = new Parser(source);
    const ast = p.expression(0);
    const sort: SortClause[] = [];
    let limit: number | undefined;
    if (p.peek('ORDER')) {
      p.next();
      p.expect('BY');
      do {
        const token = p.next();
        const field = token.value.toLowerCase();
        if (!fields.has(field)) p.error(`Unknown field '${field}'`, token);
        const direction =
          p.peek('ASC') || p.peek('DESC')
            ? (p.next().value as 'ASC' | 'DESC')
            : 'ASC';
        sort.push({
          field,
          direction,
          start: token.start,
          end: p.tokens[p.index - 1].end,
        });
        if (sort.length > MAX_SORT)
          p.error(`At most ${MAX_SORT} sort fields are allowed`, token);
      } while (p.consume(','));
    }
    if (p.peek('LIMIT')) {
      const token = p.next();
      const value = p.next();
      if (value.kind !== 'number' || !/^\d+$/.test(value.value))
        p.error('LIMIT expects a non-negative integer', value);
      limit = Number(value.value);
      if (limit > 10000) p.error('LIMIT cannot exceed 10000', token);
    }
    if (!p.peek('eof')) p.error(`Unexpected token '${p.next().value}'`);
    const diagnostics = [...p.diagnostics];
    validateTypes(ast, diagnostics);
    for (const diagnostic of diagnostics) {
      const location = position(source, diagnostic.start);
      diagnostic.line ??= location.line;
      diagnostic.column ??= location.column;
    }
    if (diagnostics.length) return { diagnostics };
    const requiredFields = new Set<string>();
    collect(ast, requiredFields);
    for (const clause of sort) requiredFields.add(clause.field);
    return { filter: { ast, requiredFields, sort, limit }, diagnostics };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid filter';
    const location = message.match(/ at (\d+):(\d+)$/);
    const line = location ? Number(location[1]) : 1;
    const column = location ? Number(location[2]) : 1;
    const offset = location
      ? source
          .split('\n')
          .slice(0, line - 1)
          .join('\n').length +
        (line > 1 ? 1 : 0) +
        column -
        1
      : 0;
    return {
      diagnostics: [
        {
          message,
          start: offset,
          end: Math.min(source.length, offset + 1),
          line,
          column,
        },
      ],
    };
  }
}
class Parser {
  tokens: Token[];
  index = 0;
  diagnostics: Diagnostic[] = [];
  constructor(private source: string) {
    this.tokens = lex(source);
  }
  peek(value: string) {
    const token = this.tokens[this.index];
    return token.kind === value || token.value.toUpperCase() === value;
  }
  next() {
    return this.tokens[this.index++];
  }
  consume(value: string) {
    if (this.peek(value)) {
      this.next();
      return true;
    }
    return false;
  }
  expect(value: string) {
    if (!this.peek(value)) this.error(`Expected ${value}`);
    else this.next();
  }
  error(
    message: string,
    token = this.tokens[Math.min(this.index, this.tokens.length - 1)],
  ): never {
    throw new SyntaxError(
      `${message} at ${position(this.source, token.start).line}:${position(this.source, token.start).column}`,
    );
  }
  expression(depth: number): QueryAst {
    if (depth > MAX_DEPTH)
      this.error(`Expression nesting exceeds ${MAX_DEPTH}`);
    return this.or(depth);
  }
  or(depth: number) {
    let node = this.and(depth);
    while (this.consume('OR')) {
      const right = this.and(depth);
      node = {
        kind: 'binary',
        op: 'OR',
        left: node,
        right,
        start: node.start,
        end: right.end,
      };
    }
    return node;
  }
  and(depth: number) {
    let node = this.unary(depth);
    while (this.consume('AND')) {
      const right = this.unary(depth);
      node = {
        kind: 'binary',
        op: 'AND',
        left: node,
        right,
        start: node.start,
        end: right.end,
      };
    }
    return node;
  }
  unary(depth: number): QueryAst {
    if (this.consume('NOT')) {
      const expression = this.unary(depth + 1);
      return {
        kind: 'not',
        expression,
        start: expression.start - 4,
        end: expression.end,
      };
    }
    if (this.consume('lparen')) {
      const node = this.expression(depth + 1);
      this.expect('rparen');
      return node;
    }
    return this.predicate();
  }
  predicate(): QueryAst {
    const fieldToken = this.next();
    const field = fieldToken.value.toLowerCase();
    if (!fields.has(field)) this.error(`Unknown field '${field}'`, fieldToken);
    if (this.consume('IS')) {
      const not = this.consume('NOT');
      const nullToken = this.tokens[this.index];
      this.expect('NULL');
      return {
        kind: 'nullcheck',
        field,
        not,
        start: fieldToken.start,
        end: nullToken.end,
      };
    }
    const operator = this.next();
    const op = operator.value.toUpperCase();
    if (op === 'ANY' || op === 'ALL' || op === 'NONE') {
      const values = this.list();
      return {
        kind: 'collection',
        field,
        op,
        value: values,
        start: fieldToken.start,
        end: this.tokens[this.index - 1].end,
      };
    }
    if (op === 'NOT' && this.consume('IN')) {
      const value = this.list();
      return {
        kind: 'comparison',
        field,
        op: 'NOT IN',
        value,
        start: fieldToken.start,
        end: this.tokens[this.index - 1].end,
      };
    }
    if (op === 'STARTS' || op === 'ENDS') {
      this.expect('WITH');
      const value = this.literal();
      return {
        kind: 'comparison',
        field,
        op: `${op} WITH`,
        value,
        start: fieldToken.start,
        end: this.tokens[this.index - 1].end,
      };
    }
    if (!['=', '!=', '<', '<=', '>', '>=', 'IN', 'CONTAINS'].includes(op))
      this.error(`Unknown operator '${op}'`, operator);
    const value = op === 'IN' ? this.list() : this.literal();
    return {
      kind: 'comparison',
      field,
      op,
      value,
      start: fieldToken.start,
      end: this.tokens[this.index - 1].end,
    };
  }
  list(): Literal[] {
    this.expect('lbracket');
    const values: Literal[] = [];
    if (!this.peek('rbracket')) {
      do {
        if (values.length >= MAX_LIST)
          this.error(`Lists are limited to ${MAX_LIST} values`);
        values.push(this.literal());
      } while (this.consume(','));
    }
    this.expect('rbracket');
    return values;
  }
  literal(): Literal {
    const token = this.next();
    if (token.kind === 'string') return token.value;
    if (token.kind === 'number') return Number(token.value);
    if (token.kind === 'duration') {
      const n = Number.parseFloat(token.value);
      const unit = token.value.replace(/^-?[\d.]+/, '');
      const multiplier =
        { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 }[
          unit
        ] ?? 0;
      return {
        kind: 'duration',
        milliseconds: n * multiplier,
        source: token.value,
      } satisfies Duration;
    }
    if (token.kind === 'date') {
      if (!isValidIsoDate(token.value)) this.error('Invalid date', token);
      return new Date(
        /^\d{4}-\d{2}-\d{2}$/.test(token.value)
          ? `${token.value}T00:00:00.000Z`
          : token.value,
      );
    }
    if (token.value === 'TRUE') return true;
    if (token.value === 'FALSE') return false;
    if (token.value === 'NULL') return null;
    this.error(`Expected a literal, got '${token.value}'`, token);
  }
}
function isValidIsoDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(.+))?$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day
  )
    return false;
  if (!match[4]) return true;
  if (
    !/^\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      match[4],
    )
  )
    return false;
  return !Number.isNaN(new Date(value).valueOf());
}
function collect(node: QueryAst, result: Set<string>) {
  if (node.kind === 'binary') {
    collect(node.left, result);
    collect(node.right, result);
  } else if (node.kind === 'not') collect(node.expression, result);
  else result.add(node.field);
}
export function position(source: string, offset: number) {
  const before = source.slice(0, offset);
  const line = before.split('\n').length;
  const column = offset - (before.lastIndexOf('\n') + 1) + 1;
  return { line, column };
}
