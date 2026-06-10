import { describe, expect, it } from 'vitest';

import { shouldUnfollowOnClear } from './useTrustAssignments';

/**
 * KUBO-164 — clearing a person's trust must also drop them from the kid's
 * kind-3 follow list, so list and trust stay coherent. The unfollow is
 * published via `useFollowActions`, which signs with the ACTIVE login, so it
 * may only run when the kid being cleared IS the active login. The full clear
 * flow is hook-wrapped; per the repo pattern we pin the pure decision helper.
 */

const KID = 'k'.repeat(64);
const OTHER = 'o'.repeat(64);

describe('shouldUnfollowOnClear (KUBO-164)', () => {
  it('unfollows when the kid being cleared is the active login', () => {
    expect(shouldUnfollowOnClear(KID, KID)).toBe(true);
  });

  it('skips when the active login is a different user (would mis-sign the kind-3)', () => {
    // e.g. the parent is the active login → unfollowMany would edit the wrong
    // follow list. Skip and rely on the gate delta + later reconcile.
    expect(shouldUnfollowOnClear(OTHER, KID)).toBe(false);
  });

  it('skips when there is no active login', () => {
    expect(shouldUnfollowOnClear(undefined, KID)).toBe(false);
  });

  it('skips when no kid is selected', () => {
    expect(shouldUnfollowOnClear(KID, undefined)).toBe(false);
  });
});
