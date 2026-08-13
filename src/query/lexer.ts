export type TokenKind =
  | 'word'
  | 'string'
  | 'number'
  | 'duration'
  | 'date'
  | 'operator'
  | 'lparen'
  | 'rparen'
  | 'lbracket'
  | 'rbracket'
  | 'comma'
  | 'eof';
export interface Token {
  kind: TokenKind;
  value: string;
  start: number;
  end: number;
}
const keywords = new Set([
  'AND',
  'OR',
  'NOT',
  'IN',
  'CONTAINS',
  'STARTS',
  'ENDS',
  'WITH',
  'ANY',
  'ALL',
  'NONE',
  'IS',
  'NULL',
  'EMPTY',
  'ORDER',
  'BY',
  'ASC',
  'DESC',
  'LIMIT',
]);
export const MAX_INPUT_LENGTH = 50_000;
export function lex(input: string): Token[] {
  if (input.length > MAX_INPUT_LENGTH)
    throw new SyntaxError(
      `Filter is limited to ${MAX_INPUT_LENGTH} characters at 1:1`,
    );
  const out: Token[] = [];
  let i = 0;
  while (i < input.length) {
    if (/\s/.test(input[i])) {
      i++;
      continue;
    }
    const start = i;
    const c = input[i];
    if (c === '(' || c === ')' || c === '[' || c === ']' || c === ',') {
      const kinds = {
        '(': 'lparen',
        ')': 'rparen',
        '[': 'lbracket',
        ']': 'rbracket',
        ',': 'comma',
      } as const;
      out.push({ kind: kinds[c], value: c, start, end: ++i });
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      let value = '';
      while (i < input.length && input[i] !== quote) {
        if (input[i] === '\\' && i + 1 < input.length) {
          value += input[i + 1];
          i += 2;
        } else value += input[i++];
      }
      if (input[i] !== quote)
        throw new SyntaxError(
          `Unterminated string at ${position(input, start)}`,
        );
      i++;
      out.push({ kind: 'string', value, start, end: i });
      continue;
    }
    const date = input.slice(i).match(/^\d{4}-\d\d-\d\d(?:T[^\s,\])]+)?/);
    if (date) {
      i += date[0].length;
      out.push({ kind: 'date', value: date[0], start, end: i });
      continue;
    }
    const number = input.slice(i).match(/^-?\d+(?:\.\d+)?/);
    if (number) {
      i += number[0].length;
      const unit = input.slice(i).match(/^(ms|s|m|h|d|w)\b/);
      if (unit) {
        i += unit[0].length;
        out.push({
          kind: 'duration',
          value: number[0] + unit[0],
          start,
          end: i,
        });
      } else out.push({ kind: 'number', value: number[0], start, end: i });
      continue;
    }
    const word = input.slice(i).match(/^[A-Za-z_][A-Za-z0-9_:.+-]*/);
    if (word) {
      i += word[0].length;
      const value = word[0];
      const upper = value.toUpperCase();
      out.push({
        kind: keywords.has(upper) ? 'operator' : 'word',
        value: upper,
        start,
        end: i,
      });
      continue;
    }
    const op = input.slice(i).match(/^(<=|>=|!=|=|<|>)/);
    if (op) {
      i += op[0].length;
      out.push({ kind: 'operator', value: op[0], start, end: i });
      continue;
    }
    throw new SyntaxError(
      `Unexpected character '${c}' at ${position(input, start)}`,
    );
  }
  out.push({ kind: 'eof', value: '', start: i, end: i });
  return out;
}

function position(input: string, offset: number): string {
  const lines = input.slice(0, offset).split('\n');
  return `${lines.length}:${lines[lines.length - 1].length + 1}`;
}
