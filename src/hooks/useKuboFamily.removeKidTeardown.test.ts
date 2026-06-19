import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { removeKid, type KuboFamily } from './useKuboFamily';

/**
 * KUBO-172 — removeKid teardown.
 *
 * Removing a kid must (a) clean the per-kid slices the prior version leaked
 * (`relayTrustAssignments[kid]` and `teppLatestPermissionIds[kid]`, alongside
 * the already-handled trustAssignments/trustRequests/kidSettings/feedSources/
 * pendingRevocations), and (b) run an optional guardian-signed teardown publish
 * BEFORE the store removal, where teardown FAILURE must not block removal.
 *
 * Pins the exported `removeKid` mutator directly (repo idiom).
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

describe('KUBO-172: removeKid clears leftover TEPP slices', () => {
  it('drops relayTrustAssignments[kid] and teppLatestPermissionIds[kid], keeps siblings', async () => {
    seedFamily({
      relayTrustAssignments: {
        [KID]: { 'wss://a/': 'view' },
        [KID2]: { 'wss://b/': 'interact' },
      },
      teppLatestPermissionIds: {
        [KID]: { view: 'vid', interact: 'iid' },
        [KID2]: { view: 'vid2' },
      },
    });

    await removeKid(KID);

    const fam = readFamily();
    expect(fam.kids.map((k) => k.pubkey)).toEqual([KID2]);
    expect(fam.relayTrustAssignments).toEqual({ [KID2]: { 'wss://b/': 'interact' } });
    expect(fam.teppLatestPermissionIds).toEqual({ [KID2]: { view: 'vid2' } });
  });

  it('cleans ALL per-kid slices in one removal', async () => {
    seedFamily({
      trustAssignments: { [KID]: { [A]: 'view' }, [KID2]: { [B]: 'interact' } },
      trustRequests: { [KID]: { [A]: { createdAt: 1 } } },
      relayTrustAssignments: { [KID]: { 'wss://a/': 'view' } },
      teppLatestPermissionIds: { [KID]: { interactRelay: 'rid' } },
      pendingRevocations: { [KID]: { [A]: 'interact' } },
      feedSources: { [KID]: { relays: [], communities: [], packs: [], youtube: [] } },
    } as Partial<KuboFamily>);

    await removeKid(KID);

    const fam = readFamily();
    expect(fam.trustAssignments).toEqual({ [KID2]: { [B]: 'interact' } });
    expect(fam.trustRequests).toEqual({});
    expect(fam.relayTrustAssignments).toEqual({});
    expect(fam.teppLatestPermissionIds).toEqual({});
    expect(fam.pendingRevocations).toEqual({});
    expect(fam.feedSources).toEqual({});
  });
});

describe('KUBO-172: removeKid teardown publish ordering + failure', () => {
  it('runs the teardown publish BEFORE store removal (kid still present at publish time)', async () => {
    seedFamily();
    let kidPresentAtPublish: boolean | undefined;
    const teardown = vi.fn(async () => {
      // At teardown time the store must still list the kid (so the guardian
      // signer + relay context are intact).
      kidPresentAtPublish = readFamily().kids.some((k) => k.pubkey === KID);
    });

    await removeKid(KID, teardown);

    expect(teardown).toHaveBeenCalledTimes(1);
    expect(kidPresentAtPublish).toBe(true);
    // And after removal the kid is gone.
    expect(readFamily().kids.map((k) => k.pubkey)).toEqual([KID2]);
  });

  it('teardown FAILURE does not block removal (kid still removed)', async () => {
    seedFamily({
      relayTrustAssignments: { [KID]: { 'wss://a/': 'view' } },
      teppLatestPermissionIds: { [KID]: { view: 'vid' } },
    });
    const teardown = vi.fn(async () => {
      throw new Error('relay unreachable');
    });

    // removeKid swallows the teardown error and proceeds — never rejects.
    await expect(removeKid(KID, teardown)).resolves.toBeUndefined();

    const fam = readFamily();
    expect(fam.kids.map((k) => k.pubkey)).toEqual([KID2]);
    // Slices are still cleaned even though the wire teardown failed.
    expect(fam.relayTrustAssignments).toEqual({});
    expect(fam.teppLatestPermissionIds).toEqual({});
  });

  it('no teardown callback → plain removal still cleans slices', async () => {
    seedFamily({ teppLatestPermissionIds: { [KID]: { view: 'vid' } } });
    await removeKid(KID);
    expect(readFamily().teppLatestPermissionIds).toEqual({});
  });
});
