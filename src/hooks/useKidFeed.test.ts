import { describe, expect, it } from 'vitest';

import { computeTeppHold } from './useKidFeed';

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
