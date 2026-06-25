import { describe, it, expect } from 'vitest';
import { possessive } from './getDisplayName';

describe('possessive', () => {
  it('adds apostrophe-s to a normal name', () => {
    expect(possessive('Jason')).toBe("Jason's");
  });

  it('adds a bare apostrophe to names ending in s', () => {
    expect(possessive('Chris')).toBe("Chris'");
    expect(possessive('James')).toBe("James'");
  });

  it('treats a trailing capital S the same way', () => {
    expect(possessive('Wells')).toBe("Wells'");
  });

  it('trims surrounding whitespace before deciding', () => {
    expect(possessive('  Jason  ')).toBe("Jason's");
  });

  it('returns empty/whitespace names unchanged (no stray apostrophe)', () => {
    expect(possessive('')).toBe('');
    expect(possessive('   ')).toBe('   ');
  });
});
