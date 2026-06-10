import { describe, expect, it } from 'vitest';

import { parseRestrictionTag, restrictionMatches } from './restrictions';

/**
 * KUBO-175: `parseKindList` (exercised via `parseRestrictionTag`) must accept
 * only base-10 non-negative integer kinds, and the time-window match must be
 * half-open `[start, end)`.
 */
describe('parseRestrictionTag — kind-list strictness (KUBO-175)', () => {
  it('accepts a comma-separated list of integer kinds', () => {
    const tag = parseRestrictionTag(['restriction', 'allow', '1,7,30023', '*', '*']);
    expect(tag.kindList).toEqual([1, 7, 30023]);
  });

  it('keeps `*` as `any`', () => {
    const tag = parseRestrictionTag(['restriction', 'deny', '*', '*', '*']);
    expect(tag.kindList).toEqual('any');
  });

  it('rejects floats / negatives / hex / exponent forms', () => {
    for (const bad of ['1.5', '-1', '0x1f', '1e3', 'abc']) {
      expect(() => parseRestrictionTag(['restriction', 'allow', bad, '*', '*'])).toThrow();
    }
  });

  it('drops non-integer tokens but keeps the integer ones', () => {
    const tag = parseRestrictionTag(['restriction', 'allow', '1,1.5,7', '*', '*']);
    expect(tag.kindList).toEqual([1, 7]);
  });
});

describe('restrictionMatches — half-open [start,end) window (KUBO-175)', () => {
  const tag = parseRestrictionTag(['restriction', 'allow', '*', '*', '09:00-17:00']);

  it('matches at the start minute (inclusive)', () => {
    expect(restrictionMatches(tag, { kind: 1, weekday: 1, minutesOfDay: 9 * 60 })).toBe(true);
  });

  it('matches just before the end minute', () => {
    expect(restrictionMatches(tag, { kind: 1, weekday: 1, minutesOfDay: 17 * 60 - 1 })).toBe(true);
  });

  it('does NOT match at the end minute (exclusive)', () => {
    expect(restrictionMatches(tag, { kind: 1, weekday: 1, minutesOfDay: 17 * 60 })).toBe(false);
  });

  it('does NOT match before the start minute', () => {
    expect(restrictionMatches(tag, { kind: 1, weekday: 1, minutesOfDay: 9 * 60 - 1 })).toBe(false);
  });
});
