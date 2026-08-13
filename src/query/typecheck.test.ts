import { describe, expect, it } from 'vitest';
import { parse } from './parser';

describe('operator categories', () => {
  it('allows numeric and date ordering but rejects text operators', () => {
    expect(parse('number > 3').diagnostics).toEqual([]);
    expect(parse('updated_at >= 2024-01-01').diagnostics).toEqual([]);
    expect(parse('number CONTAINS "3"').filter).toBeUndefined();
    expect(parse('updated_at STARTS WITH "2024"').filter).toBeUndefined();
  });
  it('allows collection operators only on collection fields', () => {
    expect(parse('labels ANY ["bug"]').diagnostics).toEqual([]);
    expect(parse('title ANY ["bug"]').filter).toBeUndefined();
    expect(parse('labels = "bug"').filter).toBeUndefined();
  });
});
