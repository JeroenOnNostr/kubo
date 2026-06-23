import { describe, expect, it } from 'vitest';

import { isTeppEnforced } from './useTeppEnforced';
import type { KuboFamily } from '@/hooks/useKuboFamily';

/**
 * KUBO-209 — TEPP is a core, non-optional protection. The enforcement predicate
 * derives SOLELY from family membership: every kid in a family is enforced and
 * there is no enable/disable flag (no `family.teppEnforced`, no kid-writable
 * synced `featureTepp`) consulted at all.
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
  it('is enforced for any kid in a family (no flag required)', () => {
    expect(isTeppEnforced(family(), KID)).toBe(true);
  });

  it('cannot be turned off: a legacy teppEnforced:false is ignored (KUBO-209)', () => {
    // The predicate no longer reads the flag at all. A family record persisted
    // with a deliberate opt-out from the pre-KUBO-209 era is still enforced —
    // TEPP is core and un-disableable.
    expect(isTeppEnforced(family({ teppEnforced: false }), KID)).toBe(true);
  });

  it('a kid synced featureTepp:false does NOT disable enforcement', () => {
    // The predicate has no featureTepp input at all — the kid's own synced
    // setting is irrelevant.
    expect(isTeppEnforced(family(), KID)).toBe(true);
  });

  it('is not enforced for the parent themselves', () => {
    expect(isTeppEnforced(family(), PARENT)).toBe(false);
  });

  it('is not enforced for a stranger (non-kid)', () => {
    expect(isTeppEnforced(family(), STRANGER)).toBe(false);
  });

  it('is enforced per-kid: only members of family.kids count', () => {
    const fam = family({ kids: [{ pubkey: KID, displayName: 'Kid' }] });
    expect(isTeppEnforced(fam, KID)).toBe(true);
    expect(isTeppEnforced(fam, OTHER_KID)).toBe(false);
  });

  it('is not enforced when there is no family record', () => {
    expect(isTeppEnforced(null, KID)).toBe(false);
    expect(isTeppEnforced(undefined, KID)).toBe(false);
  });

  it('is not enforced when the target pubkey is missing', () => {
    expect(isTeppEnforced(family(), undefined)).toBe(false);
    expect(isTeppEnforced(family(), null)).toBe(false);
  });
});
