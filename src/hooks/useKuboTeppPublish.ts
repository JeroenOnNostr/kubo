import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';

import { useParentSigner } from '@/hooks/useParentSigner';
import { useKidSigner } from '@/lib/tepp-adapters/useKidSigner';
import {
  buildAssociationTemplate,
  buildAssocATag,
  buildBlacklistTemplate,
  buildGlobalRestrictionTemplate,
  buildPermissionTemplate,
  buildStateTemplate,
  type StatePrivateSection,
} from '@/lib/tepp/buildEvents';
import {
  EXTEND_TARGET_KINDS,
  KIND_PERMISSION_INTERACTION_NPUB_A,
  KIND_PERMISSION_INTERACTION_RELAY,
  KIND_PERMISSION_VIEW_NPUB_A,
  KIND_PERMISSION_VIEW_RELAY,
  KIND_STATE,
  PERMISSION_KINDS,
} from '@/lib/tepp/kinds';
import type { PermissionRef } from '@/lib/tepp/types';
import { appendTeppAuditEntry } from '@/lib/tepp-adapters/teppAuditLog';
import { assocExpirationAt } from '@/lib/tepp-adapters/assocExpiry';
import { clearVerdictCache } from '@/lib/tepp-adapters/verdictCache';
import { readLatest, removeKid, useKuboFamily, type KuboFamily } from '@/hooks/useKuboFamily';
import { isTeppEnforced } from '@/lib/tepp-adapters/useTeppEnforced';

async function publishEvent(
  nostr: { event: (e: NostrEvent, opts?: { signal?: AbortSignal }) => Promise<void> },
  event: NostrEvent,
): Promise<NostrEvent> {
  await nostr.event(event, { signal: AbortSignal.timeout(8000) });
  return event;
}

/* -------------------------------------------------------------------------- */
/* useKuboTeppPublishAssociation                                              */
/* -------------------------------------------------------------------------- */

/**
 * Publish (or rotate) the kid's TEPP association event (kind 17700). Signed
 * by the **kid** via `useKidSigner`. The association names the parent as
 * the sole guardian in v1. Throws a typed error if the kid isn't logged in.
 */
export class TeppKidNotLoggedInError extends Error {
  reason: 'no-family' | 'not-a-kid' | 'kid-not-logged-in';
  constructor(reason: 'no-family' | 'not-a-kid' | 'kid-not-logged-in') {
    super(
      reason === 'kid-not-logged-in'
        ? 'Log in as the kid to publish or rotate their TEPP association.'
        : reason === 'not-a-kid'
          ? 'Pubkey is not a kid in this family.'
          : 'No family is configured.',
    );
    this.reason = reason;
    this.name = 'TeppKidNotLoggedInError';
  }
}

export function useKuboTeppPublishAssociation(
  kidPubkey: string | undefined,
): UseMutationResult<NostrEvent, Error, void> {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();
  const { user: kid, reason } = useKidSigner(kidPubkey);
  const { user: parent } = useParentSigner();

  return useMutation({
    mutationFn: async () => {
      if (!kid || !kidPubkey) throw new TeppKidNotLoggedInError(reason ?? 'kid-not-logged-in');
      if (!parent) throw new Error('Parent must be logged in to be named as guardian.');

      const template = buildAssociationTemplate({
        subject: kidPubkey,
        guardians: [{ pubkey: parent.pubkey }],
        expirationSeconds: assocExpirationAt(Math.floor(Date.now() / 1000)),
      });
      const signed = await kid.signer.signEvent(template);
      const event = signed as unknown as NostrEvent;
      await publishEvent(nostr, event);
      appendTeppAuditEntry({
        kind: event.kind,
        signerPubkey: kid.pubkey,
        subjectPubkey: kidPubkey,
        eventId: event.id,
        note: 'TEPP association',
      });
      return event;
    },
    onSuccess: () => {
      // Construct fingerprint just changed — flush per-event verdicts so
      // the next render re-evaluates instead of returning stale results.
      clearVerdictCache();
      queryClient.invalidateQueries({ queryKey: ['kubo-tepp-construct', kidPubkey] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* useKuboTeppPublishState                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Input shape for `useKuboTeppPublishState`.
 *
 * KUBO-171: callers NO LONGER pass `publicPermissions`. The serialized publish
 * core reads the current ref set from `teppLatestPermissionIds[kid]` via
 * `readLatest()` at sign time, so two interleaved flows can't clobber each
 * other's refs with a stale caller-supplied snapshot. Callers may still pass an
 * (optional) private section.
 */
export interface PublishStateInput {
  /** Encrypted (private) section. Default empty: `{ permissions: [] }`. */
  privateSection?: StatePrivateSection;
  /**
   * KUBO-172: publish a TEARDOWN state — kind-34700 with EMPTY refs. This is
   * the ONE place an empty-refs 34700 is correct (it tears the kid's construct
   * down on guardian sign at removal). Every other publish self-sources its
   * refs from `readLatest()`; setting this skips that read and emits zero refs.
   * Do NOT set this from the trust/relay assignment flows — clobbering live
   * refs to empty is the exact KUBO-148(d) regression we serialize to prevent.
   */
  teardownEmptyRefs?: boolean;
}

/* ── KUBO-171: per-kid serialization state (module-level) ────────────────────
 * `stateChain[kid]` is a promise tail: every state publish for a kid appends
 * to it via `.then(publish)`, so two flows that interleave their awaits (e.g.
 * useEnsureParentTrust firing phase 1 and phase 2 in the same tick, or two
 * tabs) run their sign-time `readLatest()` + publish strictly one after the
 * other. Because each reads the ref set INSIDE its turn, the second sees the
 * first's recorded permission ids → the final published state is the UNION,
 * never the loser's stale snapshot.
 *
 * `lastStateCreatedAt[kid]` tracks the created_at we last published for that
 * kid; a same-second replacement bumps to last+1 so replaceable ordering
 * (newest created_at wins, ties broken by lowest id — nondeterministic) is
 * strictly increasing and deterministic.
 */
const stateChain: Record<string, Promise<unknown>> = {};
const lastStateCreatedAt: Record<string, number> = {};

/**
 * Build the public permission refs for a kid's state event from the recorded
 * latest permission-event ids on the persisted family. Single source of truth
 * for the ref shape — the trust-page and relay-page flows used to each keep
 * their own copy (KUBO-171 consolidates them here, read at sign time).
 */
export function buildStatePublicRefs(
  family: KuboFamily | null,
  kidPubkey: string,
): PermissionRef[] {
  const ids = family?.teppLatestPermissionIds?.[kidPubkey];
  if (!ids) return [];
  const refs: PermissionRef[] = [];
  if (ids.view) refs.push({ id: ids.view, kind: KIND_PERMISSION_VIEW_NPUB_A });
  if (ids.interact) refs.push({ id: ids.interact, kind: KIND_PERMISSION_INTERACTION_NPUB_A });
  if (ids.extend && ids.extend !== ids.interact) {
    refs.push({ id: ids.extend, kind: KIND_PERMISSION_INTERACTION_NPUB_A });
  }
  if (ids.viewRelay) refs.push({ id: ids.viewRelay, kind: KIND_PERMISSION_VIEW_RELAY });
  if (ids.interactRelay) refs.push({ id: ids.interactRelay, kind: KIND_PERMISSION_INTERACTION_RELAY });
  return refs;
}

interface SerializedStatePublishArgs {
  nostr: { event: (e: NostrEvent, opts?: { signal?: AbortSignal }) => Promise<void> };
  parent: { pubkey: string; signer: { signEvent: (t: unknown) => Promise<unknown>; nip44?: { encrypt: (pubkey: string, plaintext: string) => Promise<string> } } };
  kidPubkey: string;
  privateSection: StatePrivateSection;
  teardownEmptyRefs: boolean;
}

/**
 * KUBO-171: the serialized state-publish CHOKEPOINT. Reads the ref set at sign
 * time (`readLatest()`), bumps `created_at` past the kid's last publish, signs,
 * and publishes. Every 34700 publisher routes through here via `runSerialized`
 * so per-kid ordering is total. Exported for the removeKid teardown (KUBO-172)
 * and unit tests.
 */
async function publishStateNow(args: SerializedStatePublishArgs): Promise<NostrEvent> {
  const { nostr, parent, kidPubkey, privateSection, teardownEmptyRefs } = args;
  const nip44 = parent.signer.nip44;
  if (!nip44) throw new Error('NIP-44 v2 required for TEPP state events');

  // KUBO-171: source refs HERE, at sign time, from the latest persisted family
  // — not from a caller snapshot. teardownEmptyRefs (KUBO-172) is the sole
  // exception: empty refs on purpose to dismantle a removed kid's construct.
  const publicPermissions = teardownEmptyRefs
    ? []
    : buildStatePublicRefs(await readLatest(), kidPubkey);

  const ciphertext = await nip44.encrypt(kidPubkey, JSON.stringify(privateSection));
  const template = buildStateTemplate({
    subject: kidPubkey,
    publicAssocATag: buildAssocATag(kidPubkey),
    publicPermissions,
    encryptedContent: ciphertext,
  });

  // KUBO-171: deterministic replaceable ordering. If we'd emit at (or before)
  // the same second as the previous publish for this kid, bump to last+1 so
  // created_at strictly increases and the newest state always wins.
  const last = lastStateCreatedAt[kidPubkey];
  if (last !== undefined && template.created_at <= last) {
    template.created_at = last + 1;
  }
  lastStateCreatedAt[kidPubkey] = template.created_at;

  const signed = await parent.signer.signEvent(template);
  const event = signed as unknown as NostrEvent;
  await publishEvent(nostr, event);
  appendTeppAuditEntry({
    kind: event.kind,
    signerPubkey: parent.pubkey,
    subjectPubkey: kidPubkey,
    eventId: event.id,
    note: teardownEmptyRefs
      ? 'TEPP state TEARDOWN (empty refs — kid removed)'
      : `TEPP state (${publicPermissions.length} public refs)`,
  });
  return event;
}

/**
 * KUBO-171: append a state publish for `kidPubkey` to that kid's serialization
 * chain and return its result. The chain swallows prior rejections (a failed
 * publish must not poison later ones) but each appended publish surfaces its
 * own outcome to its own caller.
 */
function runSerialized(
  kidPubkey: string,
  publish: () => Promise<NostrEvent>,
): Promise<NostrEvent> {
  const prior = stateChain[kidPubkey] ?? Promise.resolve();
  const next = prior.then(publish, publish);
  // Keep the tail alive even if THIS publish rejects, so the next enqueue still
  // serializes behind it (it just won't see a rejected predecessor).
  stateChain[kidPubkey] = next.catch(() => {});
  return next;
}

/**
 * KUBO-171 chokepoint entry point: serialize a state publish for `kidPubkey`
 * behind that kid's promise chain, sourcing refs at sign time. The hook, the
 * removeKid teardown, and tests all funnel through here so per-kid ordering and
 * the same-second created_at bump are guaranteed in one place. Exported for
 * tests (and the teardown helper below).
 */
export function publishStateSerialized(args: {
  nostr: SerializedStatePublishArgs['nostr'];
  parent: SerializedStatePublishArgs['parent'];
  kidPubkey: string;
  privateSection?: StatePrivateSection;
  teardownEmptyRefs?: boolean;
}): Promise<NostrEvent> {
  return runSerialized(args.kidPubkey, () =>
    publishStateNow({
      nostr: args.nostr,
      parent: args.parent,
      kidPubkey: args.kidPubkey,
      privateSection: args.privateSection ?? { permissions: [] },
      teardownEmptyRefs: !!args.teardownEmptyRefs,
    }),
  );
}

/**
 * KUBO-172 teardown helper: publish a guardian-signed, EMPTY-refs kind-34700
 * for `kidPubkey` through the serialized chokepoint. Used at kid removal so the
 * teardown can't race a concurrent (already-removed) reconcile publish.
 */
export async function publishStateTeardown(
  nostr: SerializedStatePublishArgs['nostr'],
  parent: SerializedStatePublishArgs['parent'],
  kidPubkey: string,
): Promise<NostrEvent> {
  return publishStateSerialized({
    nostr,
    parent,
    kidPubkey,
    privateSection: { permissions: [] },
    teardownEmptyRefs: true,
  });
}

/**
 * KUBO-172: remove a kid AND tear down their live TEPP construct.
 *
 * Returns a callback that, when the family flag is ON for this kid, publishes a
 * guardian-signed EMPTY-refs kind-34700 (via the KUBO-171 serialized chokepoint)
 * BEFORE removing the kid from the family store. Because the teardown is
 * guardian-signed it works WITHOUT the kid logged in. Teardown failure does not
 * block removal — `removeKid` swallows the publish error (the removed kid's
 * leftover construct is the status quo ante) and the removal still completes.
 *
 * Removal happens AFTER the teardown enqueues but the store write is what flips
 * `family.kids`, so any subsequent reconcile pass no longer iterates this kid
 * (reconcile hooks iterate `family.kids`) — they can't resurrect a grant for it.
 *
 * Returns a boolean: `true` if the teardown publish succeeded (or wasn't needed
 * because TEPP is off for this kid), `false` if it failed (removal still done).
 */
export function useRemoveKidWithTeardown(): (kidPubkey: string) => Promise<boolean> {
  const { nostr } = useNostr();
  const { family } = useKuboFamily();
  const { user: parent } = useParentSigner();

  return async (kidPubkey: string): Promise<boolean> => {
    const enforced = isTeppEnforced(family, kidPubkey);
    let teardownOk = true;

    if (enforced && parent) {
      const parentForPublish = parent as unknown as SerializedStatePublishArgs['parent'];
      await removeKid(kidPubkey, async () => {
        try {
          await publishStateTeardown(nostr, parentForPublish, kidPubkey);
        } catch (err) {
          teardownOk = false;
          throw err; // removeKid logs + proceeds; we just record the outcome.
        }
      });
    } else {
      // TEPP off for this kid (or no guardian to sign) → no wire teardown, just
      // remove. The slices (relayTrustAssignments/teppLatestPermissionIds) are
      // still cleaned by removeKid itself.
      await removeKid(kidPubkey);
    }

    // KUBO-172: an OPTIONAL short-expiry association (17700) rotation when the
    // kid IS logged in is deliberately SKIPPED. It would pull in the kid-signer
    // path (useKuboTeppPublishAssociation needs the kid's signer present + a
    // distinct mutation, signed by the kid not the guardian) — non-trivial, and
    // it only narrows the window on an already-best-effort teardown. The
    // guardian-signed empty-refs 34700 above already collapses the construct to
    // nothing on the next refetch, which is the load-bearing teardown.

    return teardownOk;
  };
}

/** @internal test seam — reset module-level serialization state. */
export function __resetStatePublishSerialization(): void {
  for (const k of Object.keys(stateChain)) delete stateChain[k];
  for (const k of Object.keys(lastStateCreatedAt)) delete lastStateCreatedAt[k];
}

/**
 * Publish or replace the kid's TEPP state event (kind 34700). Signed by the
 * **parent** (guardian). The private section is encrypted to the kid pubkey
 * via NIP-44 v2.
 *
 * KUBO-171: the public permission refs are sourced INSIDE the mutation from
 * `readLatest()` (the persisted `teppLatestPermissionIds[kid]`), and publishes
 * are serialized per-kid behind a module-level promise chain so interleaved
 * flows produce the UNION of their refs, not the last writer's stale snapshot.
 * Callers therefore no longer pass `publicPermissions`.
 */
export function useKuboTeppPublishState(
  kidPubkey: string | undefined,
): UseMutationResult<NostrEvent, Error, PublishStateInput | StatePrivateSection | void> {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();
  const { user: parent } = useParentSigner();

  return useMutation({
    mutationFn: async (input?: PublishStateInput | StatePrivateSection) => {
      if (!kidPubkey) throw new Error('No kid pubkey provided.');
      if (!parent) throw new Error('Parent must be logged in to publish a state event.');

      // Back-compat: a bare StatePrivateSection (with `permissions` array) is
      // treated as the private section. (Callers no longer pass refs.)
      const isBareSection = !!input && 'permissions' in input;
      const privateSection: StatePrivateSection = isBareSection
        ? (input as StatePrivateSection)
        : ((input as PublishStateInput | undefined)?.privateSection ?? { permissions: [] });
      const teardownEmptyRefs = !isBareSection
        && !!(input as PublishStateInput | undefined)?.teardownEmptyRefs;

      const parentForPublish = parent as unknown as SerializedStatePublishArgs['parent'];
      return publishStateSerialized({
        nostr,
        parent: parentForPublish,
        kidPubkey,
        privateSection,
        teardownEmptyRefs,
      });
    },
    onSuccess: () => {
      // Construct fingerprint just changed — flush per-event verdicts so
      // the next render re-evaluates instead of returning stale results.
      clearVerdictCache();
      queryClient.invalidateQueries({ queryKey: ['kubo-tepp-construct', kidPubkey] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* useKuboTeppPublishPermission                                               */
/* -------------------------------------------------------------------------- */

export interface PublishPermissionInput {
  /** Permission kind (8710–8717). */
  kind: number;
  /** Stable d-tag identifier (recommended: `<kid>:<scope>`). */
  dIdentifier: string;
  /** Pubkeys to admit (for npub-list kinds 8710/8711/8712/8713). */
  npubItems?: { pubkey: string }[];
  /** Relay URLs to admit (for relay-list kinds 8714/8715). */
  relayItems?: string[];
  /** Event ids to admit (for event-list kinds 8716/8717). */
  eventItems?: { eventId: string }[];
  /** Optional extend pairs — only mode-A kinds permitted (defence-in-depth). */
  extendPairs?: { kind: number; mutation: 'as-is' | 'to-view' }[];
}

export function useKuboTeppPublishPermission(
  kidPubkey: string | undefined,
): UseMutationResult<NostrEvent, Error, PublishPermissionInput> {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();
  const { user: parent } = useParentSigner();

  return useMutation({
    mutationFn: async (input: PublishPermissionInput) => {
      if (!kidPubkey) throw new Error('No kid pubkey provided.');
      if (!parent) throw new Error('Parent must be logged in to publish a permission event.');
      if (!(PERMISSION_KINDS as readonly number[]).includes(input.kind)) {
        throw new Error(`Kind ${input.kind} is not a permission kind.`);
      }
      if (input.extendPairs) {
        for (const pair of input.extendPairs) {
          if (!(EXTEND_TARGET_KINDS as readonly number[]).includes(pair.kind)) {
            throw new Error(
              `Mode-A only: extend target kind ${pair.kind} is not allowed (mode-B kinds 8711/8713 are forbidden in extend pairs).`,
            );
          }
        }
      }

      const template = buildPermissionTemplate({
        kind: input.kind,
        subject: kidPubkey,
        dIdentifier: input.dIdentifier,
        npubItems: input.npubItems,
        relayItems: input.relayItems,
        eventItems: input.eventItems,
        extendPairs: input.extendPairs,
      });
      const signed = await parent.signer.signEvent(template);
      const event = signed as unknown as NostrEvent;
      await publishEvent(nostr, event);
      appendTeppAuditEntry({
        kind: event.kind,
        signerPubkey: parent.pubkey,
        subjectPubkey: kidPubkey,
        eventId: event.id,
        note: `TEPP permission ${input.kind}`,
      });
      return event;
    },
    onSuccess: () => {
      // Construct fingerprint just changed — flush per-event verdicts so
      // the next render re-evaluates instead of returning stale results.
      clearVerdictCache();
      queryClient.invalidateQueries({ queryKey: ['kubo-tepp-construct', kidPubkey] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* useKuboTeppPublishBlacklist                                                */
/* -------------------------------------------------------------------------- */

export function useKuboTeppPublishBlacklist(
  kidPubkey: string | undefined,
): UseMutationResult<
  NostrEvent,
  Error,
  { dIdentifier: string; pubkeys?: string[]; relays?: string[]; eventIds?: string[] }
> {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();
  const { user: parent } = useParentSigner();

  return useMutation({
    mutationFn: async (input) => {
      if (!kidPubkey) throw new Error('No kid pubkey provided.');
      if (!parent) throw new Error('Parent must be logged in to publish a blacklist event.');
      const template = buildBlacklistTemplate({
        subject: kidPubkey,
        dIdentifier: input.dIdentifier,
        pubkeys: input.pubkeys,
        relays: input.relays,
        eventIds: input.eventIds,
      });
      const signed = await parent.signer.signEvent(template);
      const event = signed as unknown as NostrEvent;
      await publishEvent(nostr, event);
      appendTeppAuditEntry({
        kind: event.kind,
        signerPubkey: parent.pubkey,
        subjectPubkey: kidPubkey,
        eventId: event.id,
        note: 'TEPP blacklist',
      });
      return event;
    },
    onSuccess: () => {
      // Construct fingerprint just changed — flush per-event verdicts so
      // the next render re-evaluates instead of returning stale results.
      clearVerdictCache();
      queryClient.invalidateQueries({ queryKey: ['kubo-tepp-construct', kidPubkey] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* useKuboTeppPublishGlobal                                                   */
/* -------------------------------------------------------------------------- */

export function useKuboTeppPublishGlobal(
  kidPubkey: string | undefined,
): UseMutationResult<
  NostrEvent,
  Error,
  { dIdentifier: string; restrictionTags?: string[][] }
> {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();
  const { user: parent } = useParentSigner();

  return useMutation({
    mutationFn: async (input) => {
      if (!kidPubkey) throw new Error('No kid pubkey provided.');
      if (!parent) throw new Error('Parent must be logged in to publish a global restriction event.');
      const template = buildGlobalRestrictionTemplate({
        subject: kidPubkey,
        dIdentifier: input.dIdentifier,
        restrictionTags: input.restrictionTags,
      });
      const signed = await parent.signer.signEvent(template);
      const event = signed as unknown as NostrEvent;
      await publishEvent(nostr, event);
      appendTeppAuditEntry({
        kind: event.kind,
        signerPubkey: parent.pubkey,
        subjectPubkey: kidPubkey,
        eventId: event.id,
        note: 'TEPP global restriction',
      });
      return event;
    },
    onSuccess: () => {
      // Construct fingerprint just changed — flush per-event verdicts so
      // the next render re-evaluates instead of returning stale results.
      clearVerdictCache();
      queryClient.invalidateQueries({ queryKey: ['kubo-tepp-construct', kidPubkey] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Trust-tier convenience: upsert a single target into kind-8710/8712 list   */
/* -------------------------------------------------------------------------- */

/**
 * High-level helper: given a kid + target pubkey + tier ('view' | 'interact'
 * | 'extend'), produce the right `PublishPermissionInput` to upsert the
 * target into the kid's existing list. The caller fetches the current
 * permission event id (if any) so the upsert is a NIP-09-replace flow when
 * needed; if no current event exists, this is a fresh publish.
 *
 * Returns the input object only — the mutation hook handles the actual
 * signing/publishing.
 */
export function makeTrustTierUpsert(opts: {
  kidPubkey: string;
  targetPubkey: string;
  tier: 'view' | 'interact' | 'extend';
  /** Pubkeys already on the existing list (may be empty for a fresh list). */
  existingNpubs: string[];
  /** Pubkeys to remove (e.g. when downgrading from interact to view, drop from old list). */
  removePubkeys?: string[];
}): PublishPermissionInput {
  const kind =
    opts.tier === 'view'
      ? KIND_PERMISSION_VIEW_NPUB_A
      : KIND_PERMISSION_INTERACTION_NPUB_A;
  const next = new Set(opts.existingNpubs.map((p) => p.toLowerCase()));
  for (const r of opts.removePubkeys ?? []) next.delete(r.toLowerCase());
  next.add(opts.targetPubkey.toLowerCase());

  const result: PublishPermissionInput = {
    kind,
    dIdentifier: `${opts.kidPubkey}:${opts.tier}:npub`,
    npubItems: Array.from(next).map((pubkey) => ({ pubkey })),
  };

  if (opts.tier === 'extend') {
    result.extendPairs = [{ kind: KIND_PERMISSION_INTERACTION_NPUB_A, mutation: 'as-is' }];
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* Re-exports for convenience                                                 */
/* -------------------------------------------------------------------------- */

export { KIND_PERMISSION_INTERACTION_NPUB_A, KIND_PERMISSION_VIEW_NPUB_A, KIND_STATE };
export type { PermissionRef };
