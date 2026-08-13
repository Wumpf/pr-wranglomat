import { describe, expect, it } from 'vitest';
import { formatDiagnosticLocation } from './diagnostics';

describe('diagnostic locations', () => {
  it('shows only the column for a single-line expression', () => {
    expect(formatDiagnosticLocation({ line: 1, column: 9 }, false)).toBe(
      'Column 9',
    );
  });

  it('shows the line and column for a multiline expression', () => {
    expect(formatDiagnosticLocation({ line: 2, column: 3 }, true)).toBe(
      'Line 2, column 3',
    );
  });
});
