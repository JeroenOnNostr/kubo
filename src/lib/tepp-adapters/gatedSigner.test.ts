import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import type { EventTemplate, VerifiedEvent } from 'nostr-tools/pure';

import {
  TEPP_SIGNER_EXEMPT_KINDS,
  constructQueryKey,
  evaluateOutboundDraft,
  resolveConstructViaCache,
  wrapKidSigner,
} from './gatedSigner';
import { TeppDeniedError } from '@/hooks/useKuboTeppGate';
import {
  KIND_ASSOCIATION,
  KIND_PERMISSION_INTERACTION_NPUB_A,
} from '@/lib/tepp/kinds';
import type { Construct, ConstructEntry } from '@/lib/tepp/types';

/**
 * KUBO-160 — TEPP enforcement at the signer seam (`gatedSigner.ts`).
 *
 * These exercise the seam WITHOUT React: a wrapped kid signer is built with a
 * mocked queryClient/construct and `signEvent` is invoked directly, asserting:
 *  - a kid-signed kind-1 to a DENIED author throws `TeppDeniedError` at the
 *    signer level (no React, no useNostrPublish);
 *  - exempt kinds (17700 association, 13 seal, 1059 wrap, 30078 settings, 0
 *    self-profile) pass straight through, never touching the construct;
 *  - construct-unavailable (enforced but no construct) fails CLOSED;
 *  - the full signer surface (nip44 / getPublicKey / arbitrary members) passes
 *    through the proxy untouched;
 *  - parent / non-kid signers are never wrapped (the wrap is applied per-user at
 *    the materialization seam — here we assert the seam predicate via the
 *    construct query key + that an admitted author publishes).
 */

const KID = 'a'.repeat(64);
const PARENT = 'b'.repeat(64);
const ALLOWED = 'c'.repeat(64);
const DENIED = 'd'.repeat(64);

/**
 * A real construct the vendored evaluator understands: one INTERACTION entry
 * admitting `ALLOWED`. The kid (subject) is implicitly self-admitted. Any other
 * pubkey (e.g. `DENIED`) is unadmitted → outgoing deny.
 */
function buildConstruct(): Construct {
  const entry: ConstructEntry = {
    kind: KIND_PERMISSION_INTERACTION_NPUB_A,
    sourceEventId: 'e'.repeat(64),
    source: 'direct',
    items: [{ pubkey: ALLOWED }],
    restrictions: [],
    monitorRelays: [],
  };
  return {
    subject: KID,
    guardians: [PARENT],
    entries: [entry],
    extensionTraces: [],
    inertAuditFindings: [],
  };
}

/** A draft kid event p-tagging `target` (the outgoing interaction target). */
function kidReplyTo(target: string): NostrEvent {
  return {
    id: '0'.repeat(64),
    sig: '0'.repeat(128),
    pubkey: KID,
    kind: 1,
    content: 'hi',
    tags: [['p', target]],
    created_at: Math.floor(Date.now() / 1000),
  };
}

/** A query fn that returns no events — every reference resolves absent (fail-open). */
const emptyQuery = async () => [] as NostrEvent[];

describe('TEPP_SIGNER_EXEMPT_KINDS', () => {
  it('exempts the protocol / parent-channel / self / settings kinds', () => {
    expect(TEPP_SIGNER_EXEMPT_KINDS.has(KIND_ASSOCIATION)).toBe(true); // 17700
    expect(TEPP_SIGNER_EXEMPT_KINDS.has(13)).toBe(true); // NIP-59 seal
    expect(TEPP_SIGNER_EXEMPT_KINDS.has(1059)).toBe(true); // NIP-59 gift wrap
    expect(TEPP_SIGNER_EXEMPT_KINDS.has(30078)).toBe(true); // settings
    expect(TEPP_SIGNER_EXEMPT_KINDS.has(0)).toBe(true); // self-profile
  });

  it('does NOT exempt ordinary interaction kinds', () => {
    expect(TEPP_SIGNER_EXEMPT_KINDS.has(1)).toBe(false); // note/reply
    expect(TEPP_SIGNER_EXEMPT_KINDS.has(7)).toBe(false); // reaction
    expect(TEPP_SIGNER_EXEMPT_KINDS.has(6)).toBe(false); // repost
    expect(TEPP_SIGNER_EXEMPT_KINDS.has(9734)).toBe(false); // zap request
  });
});

describe('evaluateOutboundDraft (shared core)', () => {
  it('throws TeppDeniedError for a kid reply to a DENIED author', async () => {
    await expect(
      evaluateOutboundDraft({
        draft: kidReplyTo(DENIED),
        prevFollowPubkeys: null,
        query: emptyQuery,
        construct: buildConstruct(),
      }),
    ).rejects.toBeInstanceOf(TeppDeniedError);
  });

  it('resolves (no throw) for a kid reply to an ADMITTED author', async () => {
    await expect(
      evaluateOutboundDraft({
        draft: kidReplyTo(ALLOWED),
        prevFollowPubkeys: null,
        query: emptyQuery,
        construct: buildConstruct(),
      }),
    ).resolves.toBeUndefined();
  });

  it('kind-3 follow delta: a NEWLY-ADDED denied follow throws', async () => {
    const followList: NostrEvent = {
      ...kidReplyTo(DENIED),
      kind: 3,
      tags: [['p', DENIED]],
    };
    await expect(
      evaluateOutboundDraft({
        draft: followList,
        prevFollowPubkeys: [], // no prior list → DENIED is "newly added"
        query: emptyQuery,
        construct: buildConstruct(),
      }),
    ).rejects.toBeInstanceOf(TeppDeniedError);
  });

  it('kind-3 follow delta: a PRE-EXISTING denied follow is carried (no throw)', async () => {
    const followList: NostrEvent = {
      ...kidReplyTo(DENIED),
      kind: 3,
      tags: [['p', DENIED]],
    };
    await expect(
      evaluateOutboundDraft({
        draft: followList,
        prevFollowPubkeys: [DENIED], // already on record → not re-evaluated
        query: emptyQuery,
        construct: buildConstruct(),
      }),
    ).resolves.toBeUndefined();
  });
});

describe('wrapKidSigner', () => {
  /** Build a fake NUser signer whose signEvent records calls and returns a stub. */
  function fakeSigner() {
    const signEvent = vi.fn(
      async (t: EventTemplate): Promise<VerifiedEvent> =>
        ({ ...t, id: 'signed', sig: 'sig', pubkey: KID } as unknown as VerifiedEvent),
    );
    const nip44 = {
      encrypt: vi.fn(async (_pk: string, _pt: string) => 'ct'),
      decrypt: vi.fn(async (_pk: string, _ct: string) => 'pt'),
    };
    const getPublicKey = vi.fn(async () => KID);
    const signer = { signEvent, nip44, getPublicKey } as unknown as Parameters<
      typeof wrapKidSigner
    >[0];
    return { signer, signEvent, nip44, getPublicKey };
  }

  /** A queryClient pre-seeded with a construct under the shared query key. */
  function clientWithConstruct(construct: Construct | null): QueryClient {
    const qc = new QueryClient();
    qc.setQueryData(constructQueryKey(KID, PARENT), {
      construct,
      fingerprint: construct ? 'fp' : null,
    });
    // Make fetchQuery return the seeded data without a network call.
    return qc;
  }

  const baseCtx = (qc: QueryClient) => ({
    kidPubkey: KID,
    parentPubkey: PARENT,
    queryClient: qc,
    query: emptyQuery,
    nip44Decrypt: undefined,
    readPrevFollowPubkeys: () => null,
  });

  it('throws TeppDeniedError when signing a kind-1 to a DENIED author', async () => {
    const { signer, signEvent } = fakeSigner();
    const qc = clientWithConstruct(buildConstruct());
    const wrapped = wrapKidSigner(signer, baseCtx(qc));

    await expect(
      wrapped.signEvent({ kind: 1, content: 'x', tags: [['p', DENIED]], created_at: 1 }),
    ).rejects.toBeInstanceOf(TeppDeniedError);
    expect(signEvent).not.toHaveBeenCalled(); // denied BEFORE delegating
  });

  it('signs a kind-1 to an ADMITTED author (delegates through)', async () => {
    const { signer, signEvent } = fakeSigner();
    const qc = clientWithConstruct(buildConstruct());
    const wrapped = wrapKidSigner(signer, baseCtx(qc));

    await wrapped.signEvent({ kind: 1, content: 'x', tags: [['p', ALLOWED]], created_at: 1 });
    expect(signEvent).toHaveBeenCalledOnce();
  });

  it('passes exempt kinds straight through without touching the construct', async () => {
    const { signer, signEvent } = fakeSigner();
    // A queryClient whose fetchQuery would THROW — proves exempt kinds never
    // resolve the construct.
    const qc = new QueryClient();
    const fetchSpy = vi
      .spyOn(qc, 'fetchQuery')
      .mockRejectedValue(new Error('construct should not be fetched for exempt kinds'));
    const wrapped = wrapKidSigner(signer, baseCtx(qc));

    for (const kind of [KIND_ASSOCIATION, 13, 1059, 30078, 0]) {
      // Even with a p-tag to a DENIED author, an exempt kind must pass.
      await wrapped.signEvent({ kind, content: '', tags: [['p', DENIED]], created_at: 1 });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(signEvent).toHaveBeenCalledTimes(5);
  });

  it('fails CLOSED (construct-unavailable) when enforced but construct is null', async () => {
    const { signer, signEvent } = fakeSigner();
    const qc = clientWithConstruct(null); // construct: null under the key
    const wrapped = wrapKidSigner(signer, baseCtx(qc));

    await expect(
      wrapped.signEvent({ kind: 1, content: 'x', tags: [['p', ALLOWED]], created_at: 1 }),
    ).rejects.toMatchObject({ reason: 'construct-unavailable' });
    expect(signEvent).not.toHaveBeenCalled();
  });

  it('preserves the full signer surface (nip44 / getPublicKey / pass-through)', async () => {
    const { signer, nip44, getPublicKey } = fakeSigner();
    const qc = clientWithConstruct(buildConstruct());
    const wrapped = wrapKidSigner(signer, baseCtx(qc)) as unknown as {
      nip44: typeof nip44;
      getPublicKey: () => Promise<string>;
    };

    expect(await wrapped.getPublicKey()).toBe(KID);
    expect(getPublicKey).toHaveBeenCalled();
    expect(await wrapped.nip44.encrypt('x', 'y')).toBe('ct');
    expect(await wrapped.nip44.decrypt('x', 'y')).toBe('pt');
    expect(nip44.encrypt).toHaveBeenCalled();
    expect(nip44.decrypt).toHaveBeenCalled();
  });
});

describe('materialization-seam wrap contract (KUBO-160 structural)', () => {
  /**
   * Mutation-style structural guard (modelled on `assocExpiryDrift.test.ts`).
   *
   * The seam guarantee only holds if `useCurrentUser` — the single login → NUser
   * materialization point — actually wraps kid signers via `wrapKidSigner`,
   * gated on `isTeppEnforced`. If a refactor drops the wrap, every direct
   * `signer.signEvent` path (group chat, trust requests, kid profile admin, …)
   * silently bypasses TEPP again. This test fails loudly if that contract breaks.
   */
  const USE_CURRENT_USER = join(
    process.cwd(),
    'src',
    'hooks',
    'useCurrentUser.ts',
  );

  it('useCurrentUser imports and applies the kid-signer wrap', () => {
    const src = readFileSync(USE_CURRENT_USER, 'utf8');
    // Imports the wrapper + the enforcement predicate from the seam module.
    expect(src).toMatch(/import\s*\{\s*wrapKidSigner\s*\}\s*from\s*['"]@\/lib\/tepp-adapters\/gatedSigner['"]/);
    expect(src).toMatch(/isTeppEnforced/);
    // Actually calls the wrapper (not just imports it) and gates on the predicate.
    expect(src).toMatch(/wrapKidSigner\s*\(/);
    expect(src).toMatch(/isTeppEnforced\s*\(\s*family\s*,\s*u\.pubkey\s*\)/);
  });
});

describe('resolveConstructViaCache (shared query key)', () => {
  it('uses the SAME query key as useKuboTeppConstruct so the cache is shared', () => {
    expect(constructQueryKey(KID, PARENT)).toEqual(['kubo-tepp-construct', KID, PARENT]);
  });

  it('returns the cached construct without a relay fetch when warm', async () => {
    const qc = new QueryClient();
    const construct = buildConstruct();
    qc.setQueryData(constructQueryKey(KID, PARENT), { construct, fingerprint: 'fp' });
    const query = vi.fn(emptyQuery);

    const resolved = await resolveConstructViaCache({
      queryClient: qc,
      kidPubkey: KID,
      parentPubkey: PARENT,
      query,
    });
    expect(resolved).toBe(construct);
    expect(query).not.toHaveBeenCalled(); // warm cache → no relay traffic
  });
});
