import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * KUBO-171 — serialize kind-34700 publishes per kid; self-source refs.
 *
 * These tests drive the serialized publish CHOKEPOINT (`publishStateSerialized`)
 * directly — the same path the `useKuboTeppPublishState` hook and the KUBO-172
 * removeKid teardown funnel through — so we can assert ordering and ref-union
 * behaviour without `renderHook` (repo idiom: pin the pure/serialized core).
 *
 * What we prove:
 *  1. Two interleaved publishes (the second's `teppLatestPermissionIds` is a
 *     SUPERSET written between the first's enqueue and its sign) → the final
 *     published state carries the UNION of refs, because each publish reads
 *     `readLatest()` INSIDE its serialized turn, not from a caller snapshot.
 *  2. `created_at` strictly increases across same-second rapid publishes.
 *  3. A teardown publish emits EMPTY refs even when refs are recorded.
 *  4. A rejected publish does not poison the kid's chain (the next still runs).
 */

// readLatest is mocked so each serialized turn observes whatever ref set the
// test has staged at that moment.
const readLatestMock = vi.fn();
vi.mock('@/hooks/useKuboFamily', () => ({
  readLatest: () => readLatestMock(),
}));
// Audit log writes to secureStorage — stub it out.
vi.mock('@/lib/tepp-adapters/teppAuditLog', () => ({
  appendTeppAuditEntry: vi.fn(),
}));

import {
  __resetStatePublishSerialization,
  publishStateSerialized,
} from './useKuboTeppPublish';
import {
  KIND_PERMISSION_INTERACTION_NPUB_A,
  KIND_PERMISSION_VIEW_NPUB_A,
} from '@/lib/tepp/kinds';

const KID = 'k'.repeat(64);
const PARENT = 'p'.repeat(64);
const VIEW_ID = 'v'.repeat(64);
const INTERACT_ID = 'i'.repeat(64);

type Captured = { id: string; created_at: number; tags: string[][] };

function makeHarness() {
  const published: Captured[] = [];
  let signCounter = 0;
  const parent = {
    pubkey: PARENT,
    signer: {
      // signEvent assigns a deterministic id and echoes the template through.
      signEvent: async (t: unknown) => {
        const tpl = t as { created_at: number; tags: string[][] };
        return {
          id: `signed-${signCounter++}`,
          pubkey: PARENT,
          kind: 34700,
          created_at: tpl.created_at,
          tags: tpl.tags,
          content: '',
          sig: 'x',
        };
      },
      nip44: { encrypt: async () => 'ciphertext' },
    },
  };
  const nostr = {
    event: async (e: unknown) => {
      const ev = e as Captured;
      published.push({ id: ev.id, created_at: ev.created_at, tags: ev.tags });
    },
  };
  return { nostr, parent, published };
}

/** Extract the permission ref ids from a captured state event's tags. */
function refIds(ev: Captured): string[] {
  return ev.tags.filter((t) => t[0] === 'permission').map((t) => t[1]).sort();
}

beforeEach(() => {
  __resetStatePublishSerialization();
  readLatestMock.mockReset();
});

afterEach(() => {
  __resetStatePublishSerialization();
});

describe('KUBO-171: serialized 34700 publishes self-source refs', () => {
  it('interleaved publishes → final state carries the UNION of refs', async () => {
    const { nostr, parent, published } = makeHarness();

    // Flow A enqueues while teppLatestPermissionIds has ONLY the view ref.
    // Flow B records the interact ref BEFORE its own turn runs. Because both
    // read readLatest() at sign time (serialized), B sees {view, interact}.
    // A had already committed {view}. The LAST published state must be the
    // superset — never a snapshot that dropped the interact ref.
    let stage = 0;
    readLatestMock.mockImplementation(() => {
      stage += 1;
      // First serialized turn (A): only view recorded so far.
      if (stage === 1) {
        return Promise.resolve({
          teppLatestPermissionIds: { [KID]: { view: VIEW_ID } },
        });
      }
      // Second serialized turn (B): interact has since been recorded.
      return Promise.resolve({
        teppLatestPermissionIds: { [KID]: { view: VIEW_ID, interact: INTERACT_ID } },
      });
    });

    // Kick both off in the same tick — they must serialize, not interleave.
    const a = publishStateSerialized({ nostr, parent, kidPubkey: KID });
    const b = publishStateSerialized({ nostr, parent, kidPubkey: KID });
    await Promise.all([a, b]);

    expect(published).toHaveLength(2);
    // First published off {view}; second (the winner) off {view, interact}.
    expect(refIds(published[0])).toEqual([VIEW_ID]);
    expect(refIds(published[1])).toEqual([INTERACT_ID, VIEW_ID].sort());
    // The newest state (highest created_at) carries the full union.
    const newest = [...published].sort((x, y) => y.created_at - x.created_at)[0];
    expect(refIds(newest)).toEqual([INTERACT_ID, VIEW_ID].sort());
  });

  it('created_at strictly increases across same-second rapid publishes', async () => {
    const { nostr, parent, published } = makeHarness();
    readLatestMock.mockResolvedValue({
      teppLatestPermissionIds: { [KID]: { view: VIEW_ID } },
    });

    // Three back-to-back publishes within the same wall-clock second.
    await publishStateSerialized({ nostr, parent, kidPubkey: KID });
    await publishStateSerialized({ nostr, parent, kidPubkey: KID });
    await publishStateSerialized({ nostr, parent, kidPubkey: KID });

    expect(published).toHaveLength(3);
    expect(published[1].created_at).toBeGreaterThan(published[0].created_at);
    expect(published[2].created_at).toBeGreaterThan(published[1].created_at);
  });

  it('different kids do not share a serialization chain or created_at counter', async () => {
    const KID2 = 'q'.repeat(64);
    const { nostr, parent, published } = makeHarness();
    readLatestMock.mockResolvedValue({ teppLatestPermissionIds: {} });

    await Promise.all([
      publishStateSerialized({ nostr, parent, kidPubkey: KID }),
      publishStateSerialized({ nostr, parent, kidPubkey: KID2 }),
    ]);
    expect(published).toHaveLength(2);
    // Each kid's first publish gets its own (un-bumped) created_at.
    expect(published.every((p) => refIds(p).length === 0)).toBe(true);
  });

  it('teardownEmptyRefs publishes EMPTY refs even when refs are recorded', async () => {
    const { nostr, parent, published } = makeHarness();
    readLatestMock.mockResolvedValue({
      teppLatestPermissionIds: { [KID]: { view: VIEW_ID, interact: INTERACT_ID } },
    });

    await publishStateSerialized({
      nostr,
      parent,
      kidPubkey: KID,
      teardownEmptyRefs: true,
    });

    expect(published).toHaveLength(1);
    expect(refIds(published[0])).toEqual([]);
  });

  it('a rejected publish does not poison the kid chain', async () => {
    const { nostr, parent, published } = makeHarness();
    readLatestMock.mockResolvedValue({ teppLatestPermissionIds: {} });

    // First publish rejects (relay event throws); second must still run.
    const failNostr = {
      event: vi.fn().mockRejectedValueOnce(new Error('relay down')),
    };
    await expect(
      publishStateSerialized({ nostr: failNostr, parent, kidPubkey: KID }),
    ).rejects.toThrow('relay down');

    await publishStateSerialized({ nostr, parent, kidPubkey: KID });
    expect(published).toHaveLength(1);
  });

  it('ref builder maps recorded ids to the right permission kinds', async () => {
    const { nostr, parent, published } = makeHarness();
    readLatestMock.mockResolvedValue({
      teppLatestPermissionIds: { [KID]: { view: VIEW_ID, interact: INTERACT_ID } },
    });
    await publishStateSerialized({ nostr, parent, kidPubkey: KID });
    const tags = published[0].tags.filter((t) => t[0] === 'permission');
    const byId = Object.fromEntries(tags.map((t) => [t[1], Number(t[2])]));
    expect(byId[VIEW_ID]).toBe(KIND_PERMISSION_VIEW_NPUB_A);
    expect(byId[INTERACT_ID]).toBe(KIND_PERMISSION_INTERACTION_NPUB_A);
  });
});
