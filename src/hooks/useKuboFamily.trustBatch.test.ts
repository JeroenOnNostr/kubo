import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  addKid,
  setTrustLevel,
  setTrustLevelsBatch,
  type KuboFamily,
} from './useKuboFamily';

// The family store persists via secureStorage, which falls back to
// localStorage on non-native (the test env). These tests drive the exported
// async mutators directly — each uses readLatest() (fresh storage read), so
// they're independent of the module-level cached `family` var.

const STORAGE_KEY = 'kubo:family';
const PARENT = 'p'.repeat(64);
const KID = 'k'.repeat(64);
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

function seedFamily(overrides: Partial<KuboFamily> = {}): void {
  const family: KuboFamily = {
    parentPubkey: PARENT,
    parentDisplayName: 'Parent',
    kids: [{ pubkey: KID, displayName: 'Kid' }],
    ...overrides,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(family));
}

function readFamily(): KuboFamily {
  return JSON.parse(localStorage.getItem(STORAGE_KEY)!) as KuboFamily;
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  localStorage.clear();
});

describe('setTrustLevelsBatch', () => {
  it('assigns all unassigned targets to the given level in one write', async () => {
    seedFamily();
    const newlyAssigned = await setTrustLevelsBatch(KID, [A, B, C], 'view');

    expect(new Set(newlyAssigned)).toEqual(new Set([A, B, C]));
    expect(readFamily().trustAssignments?.[KID]).toEqual({
      [A]: 'view',
      [B]: 'view',
      [C]: 'view',
    });
  });

  it('skips already-assigned targets (no-downgrade) and reports only the new ones', async () => {
    seedFamily({
      trustAssignments: { [KID]: { [A]: 'interact', [B]: 'extend' } },
    });

    const newlyAssigned = await setTrustLevelsBatch(KID, [A, B, C], 'view');

    // A and B keep their higher tiers; only C is newly assigned.
    expect(newlyAssigned).toEqual([C]);
    expect(readFamily().trustAssignments?.[KID]).toEqual({
      [A]: 'interact',
      [B]: 'extend',
      [C]: 'view',
    });
  });

  it('dedupes repeated targets and returns [] when nothing is new', async () => {
    seedFamily({ trustAssignments: { [KID]: { [A]: 'view' } } });

    const dup = await setTrustLevelsBatch(KID, [B, B, B], 'view');
    expect(dup).toEqual([B]);

    const nothingNew = await setTrustLevelsBatch(KID, [A, B], 'view');
    expect(nothingNew).toEqual([]);
  });
});

describe('addKid — parent trust seed (KUBO-147)', () => {
  it('seeds the parent at interact in a genuinely new kid trust domain', async () => {
    const KID2 = 'd'.repeat(64);
    seedFamily(); // family has KID already, no trust assignments
    await addKid({ pubkey: KID2, displayName: 'Kid Two' });

    expect(readFamily().trustAssignments?.[KID2]?.[PARENT]).toBe('interact');
  });

  it('does not seed (or clobber) the parent for an existing kid', async () => {
    // KID already exists with the parent manually downgraded to view.
    seedFamily({ trustAssignments: { [KID]: { [PARENT]: 'view' } } });
    await addKid({ pubkey: KID, displayName: 'Kid Renamed' });

    // Re-adding an existing kid must not re-seed/upgrade the parent entry.
    expect(readFamily().trustAssignments?.[KID]?.[PARENT]).toBe('view');
  });
});

describe('no-downgrade composition (setLevel vs batch)', () => {
  it('a prior approved interact survives a later batch view grant', async () => {
    seedFamily();
    // Simulate an approved trust-upgrade request setting interact.
    await setTrustLevel(KID, A, 'interact');
    // Later, A is also a member of a follow pack added to the feed.
    const newlyAssigned = await setTrustLevelsBatch(KID, [A], 'view');

    expect(newlyAssigned).toEqual([]); // not re-assigned
    expect(readFamily().trustAssignments?.[KID]?.[A]).toBe('interact');
  });
});
