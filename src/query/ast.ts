export type Literal =
  string | number | boolean | null | Date | Duration | Literal[];
export interface Duration {
  kind: 'duration';
  milliseconds: number;
  source: string;
}
export interface Span {
  start: number;
  end: number;
}
export type QueryAst =
  | ({
      kind: 'binary';
      op: 'AND' | 'OR';
      left: QueryAst;
      right: QueryAst;
    } & Span)
  | ({ kind: 'not'; expression: QueryAst } & Span)
  | ({ kind: 'comparison'; field: string; op: string; value: Literal } & Span)
  | ({
      kind: 'collection';
      field: string;
      op: 'ANY' | 'ALL' | 'NONE';
      value: Literal[];
    } & Span)
  | ({ kind: 'nullcheck'; field: string; not: boolean } & Span);
export interface SortClause extends Span {
  field: string;
  direction: 'ASC' | 'DESC';
}
export interface CompiledFilter {
  ast: QueryAst;
  requiredFields: Set<string>;
  sort: SortClause[];
  limit?: number;
}
export interface Diagnostic {
  message: string;
  start: number;
  end: number;
  line?: number;
  column?: number;
}
