import type { Diagnostic } from '../query/ast';

export function formatDiagnosticLocation(
  diagnostic: Pick<Diagnostic, 'line' | 'column'>,
  multiline: boolean,
): string {
  if (multiline && diagnostic.line !== undefined) {
    return diagnostic.column === undefined
      ? `Line ${diagnostic.line}`
      : `Line ${diagnostic.line}, column ${diagnostic.column}`;
  }
  return diagnostic.column === undefined ? '' : `Column ${diagnostic.column}`;
}
