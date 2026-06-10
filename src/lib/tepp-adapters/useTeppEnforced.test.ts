import { describe, expect, it } from 'vitest';

import {
  isTeppEnforced,
  resolveInitialTeppEnforced,
  KUBO_151_RELEASE_EPOCH_SECONDS,
} from './useTeppEnforced';
import type { KuboFamily } from '@/hooks/useKuboFamily';

/**
 * KUBO-152 — the enforcement predicate must derive solely from the
 * parent-controlled family flag (`family.teppEnforced`) + family membership,
 * NEVER from the kid-writable synced `featureTepp`.
 */

const KID = 'k'.repeat(64);
const OTHER_KID = 'o'.repeat(64);
const PARENT = 'p'.repeat(64);
const STRANGER = 's'.repeat(64);

function family(overrides: Partial<KuboFamily> = {}): KuboFamily {
  return {
    parentPubkey: PARENT,
    parentDisplayName: 'Parent',
    kids: [{ pubkey: KID, displayName: 'Kid' }],
    ...overrides,
  };
}

describe('isTeppEnforced', () => {
  it('is enforced for a kid when the family flag is on', () => {
    expect(isTeppEnforced(family({ teppEnforced: true }), KID)).toBe(true);
  });

  it('a kid synced featureTepp:false does NOT disable enforcement (KUBO-152)', () => {
    // The predicate never even sees featureTepp — it reads only the family
    // record. This test documents that the kid's own synced setting is
    // irrelevant: with the family flag on, the kid stays enforced regardless
    // of any value the kid could author in their own kind-30078.
    const fam = family({ teppEnforced: true });
    // Simulate the kid having synced featureTepp:false (which the predicate
    // must ignore entirely): the predicate has no featureTepp input at all.
    expect(isTeppEnforced(fam, KID)).toBe(true);
  });

  it('the family flag OFF disables enforcement', () => {
    expect(isTeppEnforced(family({ teppEnforced: false }), KID)).toBe(false);
  });

  it('an unset family flag (undefined) is treated as not enforced', () => {
    expect(isTeppEnforced(family({ teppEnforced: undefined }), KID)).toBe(false);
  });

  it('is not enforced for the parent themselves even when the flag is on', () => {
    expect(isTeppEnforced(family({ teppEnforced: true }), PARENT)).toBe(false);
  });

  it('is not enforced for a stranger (non-kid) even when the flag is on', () => {
    expect(isTeppEnforced(family({ teppEnforced: true }), STRANGER)).toBe(false);
  });

  it('is enforced per-kid: only members of family.kids count', () => {
    const fam = family({
      teppEnforced: true,
      kids: [{ pubkey: KID, displayName: 'Kid' }],
    });
    expect(isTeppEnforced(fam, KID)).toBe(true);
    expect(isTeppEnforced(fam, OTHER_KID)).toBe(false);
  });

  it('is not enforced when there is no family record', () => {
    expect(isTeppEnforced(null, KID)).toBe(false);
    expect(isTeppEnforced(undefined, KID)).toBe(false);
  });

  it('is not enforced when the target pubkey is missing', () => {
    expect(isTeppEnforced(family({ teppEnforced: true }), undefined)).toBe(false);
    expect(isTeppEnforced(family({ teppEnforced: true }), null)).toBe(false);
  });
});

/**
 * KUBO-168 — the ONE-TIME initialization decision for the family flag. The
 * KUBO-151 default-ON intent must win for legacy users (whose synced
 * `featureTepp:false` predates the release), while a deliberate post-release
 * opt-out must be honoured.
 */
describe('resolveInitialTeppEnforced', () => {
  const EPOCH = KUBO_151_RELEASE_EPOCH_SECONDS;
  const PRE_EPOCH = EPOCH - 24 * 60 * 60; // a day before release
  const POST_EPOCH = EPOCH + 24 * 60 * 60; // a day after release

  it('exposes the KUBO-151 epoch as 2026-06-10T00:00:00Z in Unix seconds', () => {
    expect(KUBO_151_RELEASE_EPOCH_SECONDS).toBe(
      Math.floor(Date.parse('2026-06-10T00:00:00Z') / 1000),
    );
  });

  it('mirror true → ON regardless of event age', () => {
    expect(resolveInitialTeppEnforced(true, undefined, EPOCH)).toBe(true);
    expect(resolveInitialTeppEnforced(true, PRE_EPOCH, EPOCH)).toBe(true);
    expect(resolveInitialTeppEnforced(true, POST_EPOCH, EPOCH)).toBe(true);
  });

  it('mirror false + no synced event → ON (default-ON wins; no opt-out exists)', () => {
    expect(resolveInitialTeppEnforced(false, undefined, EPOCH)).toBe(true);
  });

  it('legacy user: mirror false synced BEFORE the epoch → ON (KUBO-168 fix)', () => {
    expect(resolveInitialTeppEnforced(false, PRE_EPOCH, EPOCH)).toBe(true);
  });

  it('deliberate post-release opt-out: mirror false synced AFTER the epoch → OFF', () => {
    expect(resolveInitialTeppEnforced(false, POST_EPOCH, EPOCH)).toBe(false);
  });

  it('a false authored exactly AT the epoch counts as deliberate → OFF', () => {
    expect(resolveInitialTeppEnforced(false, EPOCH, EPOCH)).toBe(false);
  });
});
