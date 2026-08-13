import { describe, expect, it } from 'vitest';
import { parseLinkHeader } from './links';

describe('GitHub Link metadata', () => {
  it('extracts next and last relations', () => {
    expect(
      parseLinkHeader(
        '<https://api.github.com/p?page=2>; rel="next", <https://api.github.com/p?page=4>; rel="last"',
      ),
    ).toEqual({
      next: 'https://api.github.com/p?page=2',
      last: 'https://api.github.com/p?page=4',
    });
  });
  it('handles missing or malformed values safely', () => {
    expect(parseLinkHeader(undefined)).toEqual({});
    expect(parseLinkHeader('<not a link>; nope')).toEqual({});
  });
});
