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
  KIND_PERMISSION_VIEW_NPUB_A,
  KIND_STATE,
  PERMISSION_KINDS,
} from '@/lib/tepp/kinds';
import type { PermissionRef } from '@/lib/tepp/types';
import { appendTeppAuditEntry } from '@/lib/tepp-adapters/teppAuditLog';
import { clearVerdictCache } from '@/lib/tepp-adapters/verdictCache';

/** 30 days, in seconds — spec recommended NIP-40 expiration for kind 17700. */
const ASSOC_EXPIRATION_SECONDS = 30 * 24 * 60 * 60;

function nowPlus(seconds: number): number {
  return Math.floor(Date.now() / 1000) + seconds;
}

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
        expirationSeconds: nowPlus(ASSOC_EXPIRATION_SECONDS),
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

/** Input shape for `useKuboTeppPublishState`. */
export interface PublishStateInput {
  /** Encrypted (private) section. Default empty: `{ permissions: [] }`. */
  privateSection?: StatePrivateSection;
  /** Public permission refs listed on the state event (visible to relays). */
  publicPermissions?: PermissionRef[];
}

/**
 * Publish or replace the kid's TEPP state event (kind 34700). Signed by the
 * **parent** (guardian). The private section is encrypted to the kid pubkey
 * via NIP-44 v2 — uses the proven nested form `signer.nip44.encrypt(
 * recipient, plaintext)`, NOT the TEPP flat form (the adapter is only used
 * when invoking vendored TEPP code; here we own the publish path).
 *
 * Accepts both a private section AND public permission refs; the construct's
 * permission walk concatenates both. v1 default: `publicPermissions` is the
 * source of truth — `useTrustAssignments` re-publishes state with the full
 * set of currently-published permission event ids after every assignment
 * change so the construct picks up the new permission immediately.
 */
export function useKuboTeppPublishState(
  kidPubkey: string | undefined,
): UseMutationResult<NostrEvent, Error, PublishStateInput | StatePrivateSection> {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();
  const { user: parent } = useParentSigner();

  return useMutation({
    mutationFn: async (input: PublishStateInput | StatePrivateSection) => {
      if (!kidPubkey) throw new Error('No kid pubkey provided.');
      if (!parent) throw new Error('Parent must be logged in to publish a state event.');
      const nip44 = (parent.signer as unknown as {
        nip44?: { encrypt: (pubkey: string, plaintext: string) => Promise<string> };
      }).nip44;
      if (!nip44) throw new Error('NIP-44 v2 required for TEPP state events');

      // Back-compat: a bare StatePrivateSection (with `permissions` array)
      // is treated as the private section.
      const isBareSection = 'permissions' in input;
      const privateSection: StatePrivateSection = isBareSection
        ? (input as StatePrivateSection)
        : ((input as PublishStateInput).privateSection ?? { permissions: [] });
      const publicPermissions: PermissionRef[] = isBareSection
        ? []
        : ((input as PublishStateInput).publicPermissions ?? []);

      const plaintext = JSON.stringify(privateSection);
      const ciphertext = await nip44.encrypt(kidPubkey, plaintext);

      const template = buildStateTemplate({
        subject: kidPubkey,
        publicAssocATag: buildAssocATag(kidPubkey),
        publicPermissions,
        encryptedContent: ciphertext,
      });
      const signed = await parent.signer.signEvent(template);
      const event = signed as unknown as NostrEvent;
      await publishEvent(nostr, event);
      appendTeppAuditEntry({
        kind: event.kind,
        signerPubkey: parent.pubkey,
        subjectPubkey: kidPubkey,
        eventId: event.id,
        note: `TEPP state (${publicPermissions.length} public refs)`,
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
