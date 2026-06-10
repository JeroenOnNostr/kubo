import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { useAppContext } from '@/hooks/useAppContext';
import { useParentSigner } from '@/hooks/useParentSigner';
import { parseAssociation, pickCurrentAssociation } from '@/lib/tepp/parse';
import { pickCurrentState } from '@/lib/tepp/parseState';
import { parsePermission } from '@/lib/tepp/parsePermission';
import { parseBlacklist } from '@/lib/tepp/parseBlacklist';
import { parseGlobal } from '@/lib/tepp/parseGlobal';
import {
  KIND_ASSOCIATION,
  KIND_BLACKLIST,
  KIND_GLOBAL_RESTRICTION,
  KIND_STATE,
  PERMISSION_KINDS,
} from '@/lib/tepp/kinds';
import type {
  Construct,
  ParsedAssociation,
  ParsedBlacklist,
  ParsedGlobal,
  ParsedPermission,
  ParsedState,
  PermissionRef,
} from '@/lib/tepp/types';

import { assembleConstruct } from './construct';
import { constructFingerprintSync } from './fingerprint';

export interface UseKuboTeppConstructResult {
  /** Assembled construct, or null when unavailable (flag off, no kid, no assoc, error). */
  construct: Construct | null;
  /** Stable cache-key fingerprint, or null when no construct. */
  fingerprint: string | null;
  /** True while any underlying query is loading. */
  loading: boolean;
  /** Free-form reason when construct is null but a kid pubkey was given. */
  reason?:
    | 'flag-off'
    | 'no-kid'
    | 'no-association'
    | 'no-state-event'
    | 'parent-logged-out'
    | 'decrypt-failed'
    | 'fetch-failed';
  /** Error message attached when reason === 'fetch-failed' or 'decrypt-failed'. */
  errorMessage?: string;
}

/** 10-minute clock-skew allowance for association `created_at` (KUBO-157). */
export const ASSOC_CREATED_AT_SKEW_SECONDS = 600;

/**
 * KUBO-157: pick the current valid association for a specific family, applying
 * Kubo-side integrity checks the vendored picker can't (it has no knowledge of
 * who the real parent is):
 *
 * 1. Future-dating clamp — drop candidates whose `created_at` is more than
 *    `ASSOC_CREATED_AT_SKEW_SECONDS` ahead of `now`. Without this a kid-signed
 *    17700 dated years ahead permanently wins `pickCurrentAssociation`'s
 *    max-`created_at` sort.
 * 2. Structural rejection — drop candidates whose parse flags a missing subject
 *    or missing guardian tag (we accept missing *expiration* deliberately: Kubo
 *    always emits one and the picker fails-closed on a present-but-invalid one).
 * 3. Guardian pinning — after picking, require the winning association's guardian
 *    set to include the family's known parent pubkey. Otherwise a kid could name
 *    their own second key as guardian and self-govern; treat as no-association.
 *
 * Returns the picked `ParsedAssociation`, or `null` (→ caller reports
 * `no-association`). Pure and React-free so it's unit-testable directly.
 */
export function pickAssociationForFamily(
  events: NostrEvent[],
  parentPubkey: string,
  now: number = Math.floor(Date.now() / 1000),
): ParsedAssociation | null {
  const skewCutoff = now + ASSOC_CREATED_AT_SKEW_SECONDS;
  const candidates = events.filter((e) => {
    if (e.created_at > skewCutoff) return false; // future-dated — drop
    const parsed = (() => {
      try {
        return parseAssociation(e);
      } catch {
        return null;
      }
    })();
    if (!parsed) return false;
    const { parseProblems } = parsed.validity;
    if (parseProblems.includes('Missing required subject tag')) return false;
    if (parseProblems.includes('No guardian tags found')) return false;
    return true;
  });

  const picked = pickCurrentAssociation(candidates);
  if (!picked) return null;

  // Guardian pinning: the family's real parent must be among the guardians.
  const parentLower = parentPubkey.toLowerCase();
  const namesParent = picked.guardians.some((g) => g.pubkey.toLowerCase() === parentLower);
  if (!namesParent) return null;

  return picked;
}

/**
 * Kubo-owned reimplementation of TEPP's `useConstruct`, rebuilt on TanStack
 * Query so it shares cache invariants with the rest of the app. The query
 * key includes the latest association event id — rotating the assoc
 * atomically invalidates the construct.
 *
 * When `featureTepp` is false OR no kidPubkey is provided, returns
 * `{construct: null, fingerprint: null, loading: false, reason: 'flag-off'|'no-kid'}`
 * early without any relay traffic.
 */
export function useKuboTeppConstruct(kidPubkey: string | undefined): UseKuboTeppConstructResult {
  const { nostr } = useNostr();
  const { config } = useAppContext();
  const { user: parent, reason: parentReason } = useParentSigner();

  const enabled = Boolean(
    config.feedSettings.featureTepp && kidPubkey && parent,
  );

  const query = useQuery<{
    construct: Construct | null;
    fingerprint: string | null;
    reason?: UseKuboTeppConstructResult['reason'];
    errorMessage?: string;
  }>({
    queryKey: ['kubo-tepp-construct', kidPubkey ?? null, parent?.pubkey ?? null],
    enabled,
    // Short staleTime so a fresh trust assignment is reflected in the kid
    // feed within seconds. Fetch is cheap (small filter on a small relay
    // set); the verdict cache absorbs per-event evaluation cost.
    staleTime: 5_000,
    gcTime: 5 * 60_000,
    // KUBO-152: while the construct is null for a TRANSIENT reason (the
    // association/state/permission events exist but haven't propagated to the
    // queried relays yet — common in the seconds right after onboarding seeds
    // them), poll so the kid feed's hold-until-ready gate resolves quickly
    // instead of waiting for the next staleTime window or a manual
    // invalidation. Stops the moment a construct loads OR a terminal reason
    // (flag-off / no-kid / parent-logged-out) is reached.
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 1_500; // first fetch in flight / errored — keep trying
      if (data.construct) return false; // loaded — stop polling
      const transient =
        data.reason === 'no-association' ||
        data.reason === 'no-state-event' ||
        data.reason === 'fetch-failed' ||
        data.reason === 'decrypt-failed';
      return transient ? 1_500 : false;
    },
    queryFn: async ({ signal }) => {
      // Re-check guards inside the query (TS narrowing + safety):
      if (!kidPubkey || !parent) {
        return { construct: null, fingerprint: null, reason: 'no-kid' as const };
      }

      // 1. Association — kid-signed kind 17700 with subject = kidPubkey.
      const assocEvents: NostrEvent[] = await nostr.query(
        [{ kinds: [KIND_ASSOCIATION], authors: [kidPubkey], limit: 10 }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) },
      );
      // KUBO-157: future-dating clamp, structural rejection, and guardian
      // pinning against the family's known parent (parent.pubkey). A winning
      // association that does not name the real parent as a guardian is treated
      // as no-association (a kid cannot self-govern by naming their own key).
      const assoc = pickAssociationForFamily(assocEvents, parent.pubkey);
      if (!assoc) {
        return { construct: null, fingerprint: null, reason: 'no-association' as const };
      }

      // 2. State — parent-signed kind 34700 with d=kidPubkey, authored by a guardian.
      const guardianPubkeys = assoc.guardians.map((g) => g.pubkey);
      const stateEvents: NostrEvent[] = await nostr.query(
        [{
          kinds: [KIND_STATE],
          authors: guardianPubkeys,
          '#d': [kidPubkey.toLowerCase()],
          limit: 50,
        }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) },
      );
      if (stateEvents.length === 0) {
        return { construct: null, fingerprint: null, reason: 'no-state-event' as const };
      }
      const guardianSet = new Set(guardianPubkeys.map((p) => p.toLowerCase()));
      const picked = pickCurrentState(stateEvents.map((e) => e), guardianSet);
      if (!picked) {
        return { construct: null, fingerprint: null, reason: 'no-state-event' as const };
      }
      const state: ParsedState = picked.current;

      // 3. Decrypt the private section (NIP-44 v2).
      let decryptedPermissions: PermissionRef[] = [];
      let decryptedBlacklistRef: string | undefined;
      let decryptedGlobalRef: string | undefined;
      const nip44 = (parent.signer as unknown as {
        nip44?: { decrypt: (pubkey: string, ciphertext: string) => Promise<string> };
      }).nip44;
      if (state.raw.content && nip44) {
        try {
          // The state event's private section is encrypted by the parent
          // *to the kid* (subject) per `useKuboTeppPublishState`. NIP-44 v2
          // conversation keys are symmetric, so the parent decrypts the
          // same content by passing the kid pubkey as the other party.
          // Earlier this passed `state.guardian` (= parent's own pubkey),
          // which produced "invalid MAC" because the conversation key
          // was self↔self instead of parent↔kid.
          const plaintext = await nip44.decrypt(kidPubkey, state.raw.content);
          const parsed = JSON.parse(plaintext) as {
            blacklist?: string;
            global?: string;
            permissions?: Array<{ id: string; kind: number }>;
          };
          decryptedBlacklistRef = parsed.blacklist;
          decryptedGlobalRef = parsed.global;
          decryptedPermissions = (parsed.permissions ?? []).map((p) => ({
            id: p.id,
            kind: p.kind,
          }));
        } catch (err) {
          return {
            construct: null,
            fingerprint: null,
            reason: 'decrypt-failed' as const,
            errorMessage: err instanceof Error ? err.message : String(err),
          };
        }
      }

      // 4. Combine public + private refs; private overrides public for blacklist + global.
      const refs: PermissionRef[] = [...state.publicPermissions, ...decryptedPermissions];
      const seen = new Set<string>();
      const uniqRefs = refs.filter((r) =>
        seen.has(r.id) ? false : (seen.add(r.id), true),
      );
      const blacklistId = decryptedBlacklistRef ?? state.publicBlacklistRef;
      const globalId = decryptedGlobalRef ?? state.publicGlobalRef;

      // 5. Fetch referenced events.
      const allRefIds = [
        ...uniqRefs.map((r) => r.id),
        ...(blacklistId ? [blacklistId] : []),
        ...(globalId ? [globalId] : []),
      ];

      let fetched: NostrEvent[] = [];
      if (allRefIds.length > 0) {
        try {
          const filter: NostrFilter = { ids: allRefIds };
          fetched = await nostr.query([filter], {
            signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
          });
        } catch (err) {
          return {
            construct: null,
            fingerprint: null,
            reason: 'fetch-failed' as const,
            errorMessage: err instanceof Error ? err.message : String(err),
          };
        }
      }

      const fetchedById = new Map(fetched.map((e) => [e.id, e]));
      const permissions: ParsedPermission[] = [];
      for (const ref of uniqRefs) {
        const ev = fetchedById.get(ref.id);
        if (!ev) continue;
        if (!(PERMISSION_KINDS as readonly number[]).includes(ev.kind)) continue;
        permissions.push(parsePermission(ev));
      }

      let blacklist: ParsedBlacklist | undefined;
      if (blacklistId) {
        const ev = fetchedById.get(blacklistId);
        if (ev && ev.kind === KIND_BLACKLIST) blacklist = parseBlacklist(ev);
      }

      let globalEvt: ParsedGlobal | undefined;
      if (globalId) {
        const ev = fetchedById.get(globalId);
        if (ev && ev.kind === KIND_GLOBAL_RESTRICTION) globalEvt = parseGlobal(ev);
      }

      // 6. Assemble.
      const construct = assembleConstruct({
        assoc,
        state,
        permissions,
        blacklist,
        global: globalEvt,
      });

      const fingerprint = constructFingerprintSync(construct, assoc.raw.id);
      return { construct, fingerprint };
    },
  });

  if (!config.feedSettings.featureTepp) {
    return { construct: null, fingerprint: null, loading: false, reason: 'flag-off' };
  }
  if (!kidPubkey) {
    return { construct: null, fingerprint: null, loading: false, reason: 'no-kid' };
  }
  if (parentReason === 'parent-logged-out') {
    return { construct: null, fingerprint: null, loading: false, reason: 'parent-logged-out' };
  }

  if (query.isLoading) return { construct: null, fingerprint: null, loading: true };
  const data = query.data;
  if (!data) return { construct: null, fingerprint: null, loading: false };
  return {
    construct: data.construct,
    fingerprint: data.fingerprint,
    loading: false,
    reason: data.reason,
    errorMessage: data.errorMessage,
  };
}
