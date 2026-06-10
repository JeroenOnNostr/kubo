import { describe, expect, it } from 'vitest';

import { isTeppEnforced } from './useTeppEnforced';
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
