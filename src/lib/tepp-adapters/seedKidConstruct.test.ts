import { describe, expect, it } from 'vitest';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';

import { seedKidConstruct, type SeedNostr, type SeedParentSigner } from './seedKidConstruct';
import {
  KIND_PERMISSION_INTERACTION_NPUB_A,
  KIND_PERMISSION_VIEW_NPUB_A,
  KIND_ASSOCIATION,
  KIND_STATE,
} from '@/lib/tepp/kinds';

const PARENT = 'p'.repeat(64);
const MEMBER_1 = '1'.repeat(64);
const MEMBER_2 = '2'.repeat(64);
const PACK_ATAG = `30000:${'c'.repeat(64)}:kubo-default`;

function makeKid(): { nsec: `nsec1${string}`; pubkey: string } {
  const sk = generateSecretKey();
  return { nsec: nip19.nsecEncode(sk), pubkey: getPublicKey(sk) };
}

/**
 * Hermetic kid-signer stub. The production default uses NLogin/NUser → an
 * NSecSigner, but under vitest `@nostrify/react` and `@nostrify/nostrify`
 * resolve to two different `nostr-tools` copies, so real signing throws an
 * unrelated `expected Uint8Array` crypto error. We inject this so the test
 * exercises seedKidConstruct's orchestration, not nostr-tools' hashing.
 */
function stubKidSigner(pubkey: string) {
  let n = 0;
  return () => ({
    pubkey,
    signEvent: async (t: unknown) => {
      const tpl = t as Omit<NostrEvent, 'id' | 'sig' | 'pubkey'>;
      n += 1;
      return {
        ...tpl,
        pubkey,
        id: `kid-event-${n}`.padEnd(64, '0'),
        sig: '0'.repeat(128),
      } as NostrEvent;
    },
  });
}

/** Parent signer stub: signs by stamping a deterministic id/sig, encrypts as a passthrough. */
function makeParentSigner(): SeedParentSigner {
  let n = 0;
  return {
    pubkey: PARENT,
    signer: {
      signEvent: async (t) => {
        const tpl = t as Omit<NostrEvent, 'id' | 'sig' | 'pubkey'>;
        n += 1;
        return {
          ...tpl,
          pubkey: PARENT,
          id: `parent-event-${n}`.padEnd(64, '0'),
          sig: '0'.repeat(128),
        } as NostrEvent;
      },
      nip44: {
        encrypt: async (_pubkey, plaintext) => `enc(${plaintext})`,
      },
    },
  };
}

/** Records every published event; serves the given pack on query. */
function makeNostr(packEvent: NostrEvent | null): {
  nostr: SeedNostr;
  published: NostrEvent[];
} {
  const published: NostrEvent[] = [];
  const nostr: SeedNostr = {
    event: async (e) => {
      published.push(e);
    },
    query: async (filters) => {
      // Only the pack fetch queries here; return the pack event for any
      // kind-30000/39089 filter.
      const f = (filters[0] ?? {}) as { kinds?: number[] };
      if (packEvent && f.kinds?.some((k) => k === 30000 || k === 39089)) {
        return [packEvent];
      }
      return [];
    },
  };
  return { nostr, published };
}

function makePackEvent(members: string[]): NostrEvent {
  return {
    id: 'pack'.padEnd(64, '0'),
    pubkey: 'c'.repeat(64),
    kind: 30000,
    created_at: 1,
    content: '',
    sig: '0'.repeat(128),
    tags: [['d', 'kubo-default'], ...members.map((m) => ['p', m])],
  };
}

describe('seedKidConstruct', () => {
  it('publishes assoc + interact(8710) + view(8712) + state(34700) + kid kind-3, in order', async () => {
    const kid = makeKid();
    const parent = makeParentSigner();
    const { nostr, published } = makeNostr(makePackEvent([MEMBER_1, MEMBER_2]));

    const result = await seedKidConstruct({
      nostr,
      kidNsec: kid.nsec,
      kidPubkey: kid.pubkey,
      parent,
      packAtags: [PACK_ATAG],
      makeKidSigner: stubKidSigner(kid.pubkey),
    });

    const kinds = published.map((e) => e.kind);
    expect(kinds).toEqual([
      KIND_ASSOCIATION, // 17700, kid-signed
      KIND_PERMISSION_INTERACTION_NPUB_A, // 8710, parent-signed (parent listed)
      KIND_PERMISSION_VIEW_NPUB_A, // 8712, parent-signed (members listed)
      KIND_STATE, // 34700, parent-signed (both refs)
      3, // kid kind-3 follow list (members)
    ]);

    // Association: kid-signed, names parent guardian.
    const assoc = published[0];
    expect(assoc.pubkey).toBe(kid.pubkey);
    expect(assoc.tags.find((t) => t[0] === 'guardian')?.[1]).toBe(PARENT);

    // 8710 interaction: parent only.
    const interact = published[1];
    const interactPs = interact.tags.filter((t) => t[0] === 'p').map((t) => t[1]);
    expect(interactPs).toEqual([PARENT]);

    // 8712 view: both members, parent excluded.
    const view = published[2];
    const viewPs = view.tags.filter((t) => t[0] === 'p').map((t) => t[1]).sort();
    expect(viewPs).toEqual([MEMBER_1, MEMBER_2].sort());

    // State references BOTH the interact and view permission events.
    const state = published[3];
    const permRefs = state.tags.filter((t) => t[0] === 'permission');
    const refKinds = permRefs.map((t) => Number(t[2])).sort();
    expect(refKinds).toEqual([
      KIND_PERMISSION_INTERACTION_NPUB_A,
      KIND_PERMISSION_VIEW_NPUB_A,
    ].sort());
    expect(permRefs.map((t) => t[1]).sort()).toEqual(
      [result.permissionIds.interact, result.permissionIds.view].sort(),
    );

    // Kid kind-3 follows both members, signed by the kid.
    const follow = published[4];
    expect(follow.pubkey).toBe(kid.pubkey);
    expect(follow.tags.filter((t) => t[0] === 'p').map((t) => t[1]).sort()).toEqual(
      [MEMBER_1, MEMBER_2].sort(),
    );

    expect(result.viewMembers.sort()).toEqual([MEMBER_1, MEMBER_2].sort());
  });

  it('skips the 8712 view permission and kid kind-3 when no pack members resolve', async () => {
    const kid = makeKid();
    const parent = makeParentSigner();
    const { nostr, published } = makeNostr(null); // no pack served

    const result = await seedKidConstruct({
      nostr,
      kidNsec: kid.nsec,
      kidPubkey: kid.pubkey,
      parent,
      packAtags: [PACK_ATAG],
      makeKidSigner: stubKidSigner(kid.pubkey),
    });

    // assoc + interact + state only — no 8712, no kind-3.
    expect(published.map((e) => e.kind)).toEqual([
      KIND_ASSOCIATION,
      KIND_PERMISSION_INTERACTION_NPUB_A,
      KIND_STATE,
    ]);
    expect(result.viewMembers).toEqual([]);
    expect(result.permissionIds.view).toBeUndefined();

    // State still carries the interaction ref (parent admitted).
    const state = published[2];
    const permRefs = state.tags.filter((t) => t[0] === 'permission');
    expect(permRefs).toHaveLength(1);
    expect(Number(permRefs[0][2])).toBe(KIND_PERMISSION_INTERACTION_NPUB_A);
  });

  it('excludes the kid and parent from the seeded view list', async () => {
    const kid = makeKid();
    const parent = makeParentSigner();
    const { nostr, published } = makeNostr(
      makePackEvent([MEMBER_1, parent.pubkey, kid.pubkey]),
    );

    const result = await seedKidConstruct({
      nostr,
      kidNsec: kid.nsec,
      kidPubkey: kid.pubkey,
      parent,
      packAtags: [PACK_ATAG],
      makeKidSigner: stubKidSigner(kid.pubkey),
    });

    expect(result.viewMembers).toEqual([MEMBER_1]);
    const view = published.find((e) => e.kind === KIND_PERMISSION_VIEW_NPUB_A)!;
    expect(view.tags.filter((t) => t[0] === 'p').map((t) => t[1])).toEqual([MEMBER_1]);
  });

  it('throws when the kid nsec does not match the kid pubkey', async () => {
    const kid = makeKid();
    const parent = makeParentSigner();
    const { nostr } = makeNostr(null);

    await expect(
      seedKidConstruct({
        nostr,
        kidNsec: kid.nsec,
        kidPubkey: 'f'.repeat(64), // mismatch
        parent,
        packAtags: [],
        makeKidSigner: stubKidSigner(kid.pubkey),
      }),
    ).rejects.toThrow(/does not match/);
  });

  it('throws when the parent signer lacks NIP-44', async () => {
    const kid = makeKid();
    const parent = makeParentSigner();
    delete (parent.signer as { nip44?: unknown }).nip44;
    const { nostr } = makeNostr(null);

    await expect(
      seedKidConstruct({
        nostr,
        kidNsec: kid.nsec,
        kidPubkey: kid.pubkey,
        parent,
        packAtags: [],
        makeKidSigner: stubKidSigner(kid.pubkey),
      }),
    ).rejects.toThrow(/NIP-44/);
  });
});
