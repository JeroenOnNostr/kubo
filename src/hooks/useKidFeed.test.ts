import { describe, expect, it } from 'vitest';

import { computeTeppHold, isRepostOriginalAllowed } from './useKidFeed';

/**
 * KUBO-155 — fail-closed read-path hold matrix for the kid feed.
 *
 * The headline fail-open this closes: a kid feed running unscoped (the full
 * firehose) when the parent has logged out of a shared device. The pure
 * `computeTeppHold` decision must NEVER return null (proceed) when TEPP is
 * enforced and no construct is available — it must hold.
 */
describe('computeTeppHold (KUBO-155 hold matrix)', () => {
  it('not enforced → never holds (feed proceeds unscoped, as before)', () => {
    expect(computeTeppHold(false, false, false, 'flag-off')).toBeNull();
    expect(computeTeppHold(false, false, true, undefined)).toBeNull();
    expect(computeTeppHold(false, true, false, undefined)).toBeNull();
  });

  it('enforced + construct loaded → no hold', () => {
    expect(computeTeppHold(true, true, false, undefined)).toBeNull();
  });

  it('enforced + still loading → no hold (boot splash / skeleton covers it)', () => {
    expect(computeTeppHold(true, false, true, 'no-association')).toBeNull();
  });

  it('enforced + parent-logged-out → HOLD parent-logged-out (the firehose fix)', () => {
    expect(computeTeppHold(true, false, false, 'parent-logged-out')).toBe(
      'parent-logged-out',
    );
  });

  it('enforced + no-state-event (settled) → HOLD construct-unavailable', () => {
    expect(computeTeppHold(true, false, false, 'no-state-event')).toBe(
      'construct-unavailable',
    );
  });

  it('enforced + fetch-failed (settled) → HOLD construct-unavailable', () => {
    expect(computeTeppHold(true, false, false, 'fetch-failed')).toBe(
      'construct-unavailable',
    );
  });

  it('enforced + no-association / decrypt-failed (settled) → HOLD', () => {
    expect(computeTeppHold(true, false, false, 'no-association')).toBe(
      'construct-unavailable',
    );
    expect(computeTeppHold(true, false, false, 'decrypt-failed')).toBe(
      'construct-unavailable',
    );
  });

  it('enforced + null construct + unknown/undefined reason (settled) → HOLD (fail-closed)', () => {
    // Critical: even an unrecognised reason must hold, never fall through to
    // the firehose.
    expect(computeTeppHold(true, false, false, undefined)).toBe(
      'construct-unavailable',
    );
    expect(computeTeppHold(true, false, false, 'something-new')).toBe(
      'construct-unavailable',
    );
  });
});

/**
 * KUBO-159 — repost-author admission. A repost (kind 6/16) from an allowlisted
 * reposter can embed/reference an ORIGINAL authored by a non-allowlisted (or
 * blacklisted) author. The query-time allowlist only scopes the reposter, so
 * the original author must be re-checked before the item is shown.
 */
describe('isRepostOriginalAllowed (KUBO-159 repost author check)', () => {
  const ALLOWED = 'a'.repeat(64);
  const DENIED = 'b'.repeat(64);

  it('allows any original when TEPP is not active (allowSet null)', () => {
    expect(isRepostOriginalAllowed(ALLOWED, null)).toBe(true);
    expect(isRepostOriginalAllowed(DENIED, null)).toBe(true);
  });

  it('allows an original whose author is in the allowlist', () => {
    const set = new Set([ALLOWED]);
    expect(isRepostOriginalAllowed(ALLOWED, set)).toBe(true);
  });

  it('excludes a repost of a non-allowlisted original (the verified leak)', () => {
    const set = new Set([ALLOWED]);
    expect(isRepostOriginalAllowed(DENIED, set)).toBe(false);
  });

  it('is case-insensitive on the author pubkey', () => {
    const set = new Set([ALLOWED]); // lowercase, as allowedAuthors emits
    expect(isRepostOriginalAllowed(ALLOWED.toUpperCase(), set)).toBe(true);
  });

  it('excludes everything when the allowlist is empty', () => {
    const set = new Set<string>();
    expect(isRepostOriginalAllowed(ALLOWED, set)).toBe(false);
  });
});
