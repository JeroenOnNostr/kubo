import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearPendingRevocation,
  recordPendingRevocation,
  removeKid,
  type KuboFamily,
} from './useKuboFamily';

/**
 * KUBO-169 — pendingRevocations store primitives. A failed trust revocation
 * publish records the (kid, target) → previous-tier marker; the reconcile phase
 * retries the publish and clears the marker once the construct drops the target.
 * These pin the store mutators directly (repo idiom: drive the exported async
 * mutators, each of which uses readLatest()).
 */

const STORAGE_KEY = 'kubo:family';
const PARENT = 'p'.repeat(64);
const KID = 'k'.repeat(64);
const KID2 = 'j'.repeat(64);
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

function seedFamily(overrides: Partial<KuboFamily> = {}): void {
  const family: KuboFamily = {
    parentPubkey: PARENT,
    parentDisplayName: 'Parent',
    kids: [{ pubkey: KID, displayName: 'Kid' }, { pubkey: KID2, displayName: 'Kid2' }],
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

describe('recordPendingRevocation', () => {
  it('records a failed revocation with the previous tier', async () => {
    seedFamily();
    await recordPendingRevocation(KID, A, 'interact');
    expect(readFamily().pendingRevocations).toEqual({ [KID]: { [A]: 'interact' } });
  });

  it('is a no-op when re-recording the same (kid, target, tier)', async () => {
    seedFamily({ pendingRevocations: { [KID]: { [A]: 'view' } } });
    const before = localStorage.getItem(STORAGE_KEY);
    await recordPendingRevocation(KID, A, 'view');
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
  });

  it('keeps other kids and targets intact', async () => {
    seedFamily({ pendingRevocations: { [KID2]: { [B]: 'view' } } });
    await recordPendingRevocation(KID, A, 'interact');
    expect(readFamily().pendingRevocations).toEqual({
      [KID]: { [A]: 'interact' },
      [KID2]: { [B]: 'view' },
    });
  });
});

describe('clearPendingRevocation', () => {
  it('removes the marker and prunes the empty kid bucket', async () => {
    seedFamily({ pendingRevocations: { [KID]: { [A]: 'interact' } } });
    await clearPendingRevocation(KID, A);
    expect(readFamily().pendingRevocations).toEqual({});
  });

  it('keeps sibling targets for the same kid', async () => {
    seedFamily({ pendingRevocations: { [KID]: { [A]: 'interact', [B]: 'view' } } });
    await clearPendingRevocation(KID, A);
    expect(readFamily().pendingRevocations).toEqual({ [KID]: { [B]: 'view' } });
  });

  it('is a no-op when no marker exists', async () => {
    seedFamily();
    const before = localStorage.getItem(STORAGE_KEY);
    await clearPendingRevocation(KID, A);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
  });
});

describe('removeKid clears pendingRevocations (KUBO-169 teardown)', () => {
  it('drops the removed kid markers, keeps siblings', async () => {
    seedFamily({
      pendingRevocations: { [KID]: { [A]: 'interact' }, [KID2]: { [B]: 'view' } },
    });
    await removeKid(KID);
    expect(readFamily().pendingRevocations).toEqual({ [KID2]: { [B]: 'view' } });
  });
});
