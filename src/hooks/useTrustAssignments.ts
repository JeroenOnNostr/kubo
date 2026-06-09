import { useCallback } from 'react';

import { useAppContext } from '@/hooks/useAppContext';
import { useToast } from '@/hooks/useToast';
import {
  makeTrustTierUpsert,
  useKuboTeppPublishPermission,
  useKuboTeppPublishState,
} from '@/hooks/useKuboTeppPublish';
import {
  KIND_PERMISSION_INTERACTION_NPUB_A,
  KIND_PERMISSION_VIEW_NPUB_A,
  KIND_PERMISSION_INTERACTION_RELAY,
  KIND_PERMISSION_VIEW_RELAY,
} from '@/lib/tepp/kinds';
import type { PermissionRef } from '@/lib/tepp/types';

import {
  getFamilySnapshot,
  recordTeppPermissionId,
  useKuboFamily,
  type KuboTrustLevel,
} from './useKuboFamily';
import type { KuboFamily } from './useKuboFamily';

/**
 * Compose the public-refs list for the kid's state event from whatever
 * permission event ids we've successfully published so far. We re-emit the
 * full set on every update so the construct's permission-walk picks up new
 * entries on the next refetch.
 */
function buildPublicPermissionRefs(
  family: KuboFamily | null,
  kidPubkey: string,
): PermissionRef[] {
  const ids = family?.teppLatestPermissionIds?.[kidPubkey];
  if (!ids) return [];
  const refs: PermissionRef[] = [];
  if (ids.view) refs.push({ id: ids.view, kind: 8712 });
  if (ids.interact) refs.push({ id: ids.interact, kind: KIND_PERMISSION_INTERACTION_NPUB_A });
  if (ids.extend && ids.extend !== ids.interact) {
    refs.push({ id: ids.extend, kind: KIND_PERMISSION_INTERACTION_NPUB_A });
  }
  if (ids.viewRelay) refs.push({ id: ids.viewRelay, kind: KIND_PERMISSION_VIEW_RELAY });
  if (ids.interactRelay) refs.push({ id: ids.interactRelay, kind: KIND_PERMISSION_INTERACTION_RELAY });
  return refs;
}

export interface TrustAssignmentsApi {
  get: (targetPubkey: string) => KuboTrustLevel | undefined;
  setLevel: (targetPubkey: string, level: KuboTrustLevel) => Promise<void>;
  clear: (targetPubkey: string) => Promise<void>;
}

/**
 * Scoped read/write view of trust assignments for a single kid. Thin wrapper
 * over `useKuboFamily` — callers pass the kid pubkey once and don't have to
 * re-thread it through every read/write.
 *
 * **Phase 4b (TEPP integration):** when `featureTepp` is on, `setLevel` and
 * `clear` also publish the corresponding TEPP permission events:
 *   - `view`     → upserts target into kind 8712 (npub view-only, mode A)
 *   - `interact` → upserts target into kind 8710 (npub interaction, mode A)
 *   - `extend`   → upserts target into kind 8710 with an `extend` tag
 *                  pointing at `(8710, as-is)` — but ONLY if the target is
 *                  not itself a kid in our family (extend-on-kid is parked
 *                  for v2; we surface a non-blocking toast and skip the TEPP
 *                  publish, keeping the localStorage write so the UI tier
 *                  pill still flips).
 *
 * When `kidPubkey` is undefined, `get` always returns undefined and the
 * mutators throw. Callers should guard on `useSelectedKid()` first.
 */
export function useTrustAssignments(kidPubkey: string | undefined): TrustAssignmentsApi {
  const { family, setTrustLevel, clearTrustLevel } = useKuboFamily();
  const { config } = useAppContext();
  const { toast } = useToast();
  const featureTepp = !!config.feedSettings.featureTepp;
  const publishPermission = useKuboTeppPublishPermission(kidPubkey);
  const publishState = useKuboTeppPublishState(kidPubkey);

  const kidAssignments =
    kidPubkey && family?.trustAssignments
      ? family.trustAssignments[kidPubkey]
      : undefined;

  const get = useCallback(
    (targetPubkey: string): KuboTrustLevel | undefined => {
      return kidAssignments?.[targetPubkey];
    },
    [kidAssignments],
  );

  const setLevel = useCallback(
    async (targetPubkey: string, level: KuboTrustLevel) => {
      if (!kidPubkey) throw new Error('useTrustAssignments: no kid selected');
      await setTrustLevel(kidPubkey, targetPubkey, level);

      if (!featureTepp) return;

      // v1 restriction: extend cannot target a kid in this family. Toast and skip the TEPP publish.
      if (level === 'extend') {
        const targetIsKid = !!family?.kids.some((k) => k.pubkey === targetPubkey);
        if (targetIsKid) {
          toast({
            title: 'Extend not yet available for kid accounts',
            description: 'Cross-family extend is planned for a future release.',
          });
          return;
        }
      }

      // Pull the post-write snapshot from the module-level store. The
      // closure-captured `kidAssignments` is the pre-write view, so it
      // omits earlier same-tier entries written this session — publishing
      // off that snapshot would shrink the kind-8710/8712 list to one
      // entry every time the relay's addressable replaceable kicks in.
      const fresh = getFamilySnapshot()?.trustAssignments?.[kidPubkey] ?? {};
      const sameTierExisting = Object.entries(fresh)
        .filter(([, tier]) => tier === level)
        .map(([pubkey]) => pubkey)
        .filter((p) => p !== targetPubkey);

      // When upgrading from view → interact (or extend), we need to *also*
      // remove the target from the view list. v1 keeps that out of scope
      // (the parent can clear+re-set; or future Phase-4b refactor).
      try {
        const input = makeTrustTierUpsert({
          kidPubkey,
          targetPubkey,
          tier: level,
          existingNpubs: sameTierExisting,
        });
        const permissionEvent = await publishPermission.mutateAsync(input);

        // Capture the event id under teppLatestPermissionIds so the next
        // state-event publish references the new permission. Without this,
        // the construct's permission walk only ever sees the original empty
        // (or stale) set of public refs.
        // Records the permission id by reading the latest persisted family and
        // merging — so it preserves the trustAssignments entry setTrustLevel
        // just wrote instead of clobbering it with a stale snapshot.
        const nextFamily = await recordTeppPermissionId(
          kidPubkey,
          level,
          permissionEvent.id,
        );
        if (nextFamily) {
          // Re-publish the state event with the full set of currently-known
          // permission ids. This is what makes a fresh assignment actually
          // appear in the kid's construct on next refetch.
          await publishState.mutateAsync({
            publicPermissions: buildPublicPermissionRefs(nextFamily, kidPubkey),
          });
        }
      } catch (err) {
        toast({
          title: 'TEPP publish failed',
          description: err instanceof Error ? err.message : String(err),
          variant: 'destructive',
        });
        // Keep the localStorage write — the UI tier pill stays in the chosen
        // state so the parent can retry without losing their selection.
      }
    },
    [kidPubkey, setTrustLevel, featureTepp, family, publishPermission, publishState, toast],
  );

  const clear = useCallback(
    async (targetPubkey: string) => {
      if (!kidPubkey) throw new Error('useTrustAssignments: no kid selected');
      // Read previousLevel from the latest snapshot BEFORE the clear write.
      const previousLevel =
        getFamilySnapshot()?.trustAssignments?.[kidPubkey]?.[targetPubkey];
      await clearTrustLevel(kidPubkey, targetPubkey);

      if (!featureTepp || !previousLevel) return;

      // All three tiers are addressed by `${kidPubkey}:${tier}:npub`.
      //   - view     → kind 8712 (view npub)
      //   - interact → kind 8710 (interaction npub)
      //   - extend   → kind 8710 with an `extend` pair tag, on its own d-tag
      // Re-publish the surviving same-tier list so the cleared target is
      // removed from the wire. For `extend`, also re-emit the extend pair so
      // the kind-8710 event keeps its mode-A semantics for whoever remains.
      const kind =
        previousLevel === 'view'
          ? KIND_PERMISSION_VIEW_NPUB_A
          : KIND_PERMISSION_INTERACTION_NPUB_A;
      // Read post-write snapshot to compute the surviving same-tier list.
      // The closure-captured `kidAssignments` is stale relative to anything
      // written this session.
      const fresh = getFamilySnapshot()?.trustAssignments?.[kidPubkey] ?? {};
      const sameTierRemaining = Object.entries(fresh)
        .filter(([pubkey, tier]) => tier === previousLevel && pubkey !== targetPubkey)
        .map(([pubkey]) => pubkey);

      try {
        const permissionEvent = await publishPermission.mutateAsync({
          kind,
          dIdentifier: `${kidPubkey}:${previousLevel}:npub`,
          npubItems: sameTierRemaining.map((pubkey) => ({ pubkey })),
          extendPairs:
            previousLevel === 'extend'
              ? [{ kind: KIND_PERMISSION_INTERACTION_NPUB_A, mutation: 'as-is' }]
              : undefined,
        });
        const nextFamily = await recordTeppPermissionId(
          kidPubkey,
          previousLevel,
          permissionEvent.id,
        );
        if (nextFamily) {
          await publishState.mutateAsync({
            publicPermissions: buildPublicPermissionRefs(nextFamily, kidPubkey),
          });
        }
      } catch (err) {
        toast({
          title: 'TEPP publish failed',
          description: err instanceof Error ? err.message : String(err),
          variant: 'destructive',
        });
      }
    },
    [kidPubkey, clearTrustLevel, featureTepp, publishPermission, publishState, toast],
  );

  return { get, setLevel, clear };
}
