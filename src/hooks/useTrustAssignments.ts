import { useCallback } from 'react';

import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useFollowActions } from '@/hooks/useFollowActions';
import { useToast } from '@/hooks/useToast';
import {
  makeTrustTierUpsert,
  useKuboTeppPublishPermission,
  useKuboTeppPublishState,
} from '@/hooks/useKuboTeppPublish';
import {
  KIND_PERMISSION_INTERACTION_NPUB_A,
  KIND_PERMISSION_INTERACTION_NPUB_B,
  KIND_PERMISSION_VIEW_NPUB_A,
  KIND_PERMISSION_VIEW_NPUB_B,
  KIND_PERMISSION_INTERACTION_RELAY,
  KIND_PERMISSION_VIEW_RELAY,
} from '@/lib/tepp/kinds';
import type { Construct, PermissionRef } from '@/lib/tepp/types';

import {
  clearPendingRevocation,
  getFamilySnapshot,
  recordPendingRevocation,
  recordTeppPermissionId,
  setTrustLevelsBatch,
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

/**
 * KUBO-164: pure decision for whether clearing `targetPubkey`'s trust should
 * also unfollow them from the kid's kind-3. The unfollow is published via
 * `useFollowActions`, which signs with the ACTIVE login — so we only do it when
 * the active login IS the kid being cleared (otherwise we'd write the wrong
 * user's follow list). When the kid isn't the active login, we skip and rely on
 * the gate's delta evaluation (KUBO-164) plus a later reconcile.
 *
 * Exported for unit testing.
 */
export function shouldUnfollowOnClear(
  activePubkey: string | undefined,
  kidPubkey: string | undefined,
): boolean {
  return !!kidPubkey && activePubkey === kidPubkey;
}

/**
 * The npub-list permission kinds (mode A + mode B) that admit a target at a
 * given trust tier. `interact`/`extend` both live in the kind-8710/8711
 * interaction lists; `view` lives in the kind-8712/8713 view lists.
 */
function npubKindsForTier(tier: KuboTrustLevel): number[] {
  return tier === 'view'
    ? [KIND_PERMISSION_VIEW_NPUB_A, KIND_PERMISSION_VIEW_NPUB_B]
    : [KIND_PERMISSION_INTERACTION_NPUB_A, KIND_PERMISSION_INTERACTION_NPUB_B];
}

/**
 * KUBO-169: does the assembled CONSTRUCT admit `pubkey` at (at least) `tier`?
 *
 * The construct is the trustworthy oracle for "what is actually published"
 * (KUBO-156). `interact` admits anyone in the interaction lists; `view` admits
 * anyone in EITHER the view lists OR the interaction lists (interact ⊇ view —
 * an interaction grant subsumes view, so it must not be reported as missing).
 *
 * Exported for unit testing.
 */
export function constructAdmitsAtTier(
  construct: Construct,
  pubkey: string,
  tier: KuboTrustLevel,
): boolean {
  const lower = pubkey.toLowerCase();
  // For `view`, an interact-tier entry also satisfies it (no-downgrade: never
  // re-grant view to someone the construct already admits at interact).
  const kinds =
    tier === 'view'
      ? [
          KIND_PERMISSION_VIEW_NPUB_A,
          KIND_PERMISSION_VIEW_NPUB_B,
          KIND_PERMISSION_INTERACTION_NPUB_A,
          KIND_PERMISSION_INTERACTION_NPUB_B,
        ]
      : npubKindsForTier(tier);
  return construct.entries.some(
    (e) =>
      kinds.includes(e.kind) &&
      (e.items as Array<{ pubkey?: string } | string>).some((i) =>
        typeof i === 'string' ? i === lower : i?.pubkey === lower,
      ),
  );
}

/**
 * KUBO-169 pure diff helper: of `members` that localStorage records at `tier`,
 * which ones are NOT yet admitted by the published construct? These are the
 * grants that must be (re-)published — localStorage says "done" but the wire
 * disagrees (assigned-while-TEPP-off, or a failed publish). Reconcile uses the
 * CONSTRUCT, not localStorage, as the oracle for "published".
 *
 * `assignments` is the kid's `trustAssignments[kid]` map. Only members whose
 * recorded tier === `tier` are considered (so an interact entry isn't surfaced
 * as a missing view grant).
 *
 * Exported for unit testing.
 */
export function computeMissingGrants(
  assignments: Record<string, KuboTrustLevel> | undefined,
  construct: Construct,
  tier: KuboTrustLevel,
): string[] {
  if (!assignments) return [];
  return Object.entries(assignments)
    .filter(([, lvl]) => lvl === tier)
    .map(([pubkey]) => pubkey)
    .filter((pubkey) => !constructAdmitsAtTier(construct, pubkey, tier));
}

/**
 * KUBO-167 pure ordering orchestrator for request approval. Extracted from the
 * hook so the critical sequencing is unit-testable without `renderHook` (repo
 * idiom): write trust → (when enforced) publish the grant → clear the request
 * ONLY past a successful publish. A publish rejection propagates BEFORE
 * `clearRequest` runs, so a failed approval leaves the request pending and can
 * be retried. Returns nothing; throws whatever `publishGrant` throws.
 *
 * Exported for unit testing.
 */
export async function runApprovalSequence(opts: {
  enforced: boolean;
  writeTrust: () => Promise<void>;
  publishGrant: () => Promise<void>;
  clearRequest: () => Promise<void>;
}): Promise<void> {
  await opts.writeTrust();
  if (opts.enforced) {
    await opts.publishGrant(); // throws → clearRequest below never runs
  }
  await opts.clearRequest();
}

export interface TrustAssignmentsApi {
  get: (targetPubkey: string) => KuboTrustLevel | undefined;
  setLevel: (targetPubkey: string, level: KuboTrustLevel) => Promise<void>;
  /**
   * Assign `level` to `targetPubkey` ONLY if it currently has no assignment.
   * Returns true if it wrote, false if the target was already assigned (so we
   * never downgrade an existing interact/extend — the no-downgrade invariant).
   * Used by the feed-source auto-grant flows (KUBO-147).
   */
  setLevelIfUnassigned: (targetPubkey: string, level: KuboTrustLevel) => Promise<boolean>;
  /**
   * Batch-assign `level` to many targets in ONE localStorage write and, when
   * `featureTepp` is on, ONE permission publish + ONE state publish — instead
   * of N of each. Targets already assigned are skipped (no-downgrade). Used by
   * the follow-pack auto-grant flow (KUBO-147). Only `view`/`interact` tiers
   * are batched; `extend` falls back to per-target `setLevel`.
   */
  setLevelsBatch: (targetPubkeys: string[], level: KuboTrustLevel) => Promise<void>;
  clear: (targetPubkey: string) => Promise<void>;
  /**
   * KUBO-167: approve a kid's request-to-interact. Grants `interact` (writes
   * localStorage AND, when TEPP is enforced, publishes 8710 + state), then
   * clears the pending request — but ONLY on publish success. If the publish
   * fails the request is RETAINED (the error is re-thrown to the caller so the
   * UI can toast) so approval can be retried; without this the kid would see
   * "approved" while the construct never admits them (permanent divergence).
   */
  approveRequest: (targetPubkey: string) => Promise<void>;
  /**
   * KUBO-169: publish a grant for `members` at `level` covering anyone the
   * CONSTRUCT does not yet admit, regardless of whether localStorage changed.
   * Bypasses the no-localStorage-change early-return that `setLevelsBatch`
   * uses — the reconcile path needs the construct, not localStorage, as the
   * "published" oracle. ONE permission + ONE state publish for the whole union.
   * Throws on publish failure (so the reconcile guard can allow a retry).
   */
  publishMissingGrants: (members: string[], level: KuboTrustLevel) => Promise<void>;
  /**
   * KUBO-169: retry a previously-failed revocation of `targetPubkey` at
   * `previousLevel`. Re-publishes the surviving same-tier list (without the
   * target) + state. On success clears the `pendingRevocations` marker. Throws
   * on failure so the marker survives for the next session. The localStorage
   * trust entry was already removed by the original `clear`.
   */
  retryRevocation: (targetPubkey: string, previousLevel: KuboTrustLevel) => Promise<void>;
  /**
   * KUBO-169: clear a `pendingRevocations` marker for a target the construct has
   * already stopped admitting (no publish needed — the wire is already correct).
   * Thin wrapper over the store's `clearPendingRevocation`.
   */
  clearPendingRevocationMarker: (targetPubkey: string) => Promise<void>;
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
  const { family, setTrustLevel, clearTrustLevel, clearTrustRequest } = useKuboFamily();
  const { config } = useAppContext();
  const { user } = useCurrentUser();
  const { unfollowMany } = useFollowActions();
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

  /**
   * Publish a same-tier npub grant: ONE permission event (carrying the full
   * `existingNpubs` ∪ {target} list — caller computes the list) + ONE state
   * event. THROWS on failure; the caller decides whether to swallow+toast
   * (interactive `setLevel`) or propagate (`approveRequest`, reconcile). Shared
   * by setLevel / approveRequest so the publish path is identical.
   */
  const publishTierGrant = useCallback(
    async (
      targetPubkey: string,
      level: KuboTrustLevel,
      existingNpubs: string[],
    ): Promise<void> => {
      if (!kidPubkey) throw new Error('useTrustAssignments: no kid selected');
      const input = makeTrustTierUpsert({
        kidPubkey,
        targetPubkey,
        tier: level,
        existingNpubs,
      });
      const permissionEvent = await publishPermission.mutateAsync(input);
      // Capture the event id under teppLatestPermissionIds so the next state
      // publish references the new permission. recordTeppPermissionId reads the
      // latest persisted family and merges, preserving the trustAssignments
      // entry instead of clobbering it with a stale snapshot.
      const nextFamily = await recordTeppPermissionId(
        kidPubkey,
        level,
        permissionEvent.id,
      );
      if (nextFamily) {
        await publishState.mutateAsync({
          publicPermissions: buildPublicPermissionRefs(nextFamily, kidPubkey),
        });
      }
    },
    [kidPubkey, publishPermission, publishState],
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
        await publishTierGrant(targetPubkey, level, sameTierExisting);
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
    [kidPubkey, setTrustLevel, featureTepp, family, publishTierGrant, toast],
  );

  /**
   * KUBO-167 — approve a kid's request-to-interact. Ordering matters: write
   * localStorage trust, then (TEPP on) publish the grant, then clear the
   * request ONLY if the publish succeeded. A failed publish RE-THROWS without
   * clearing the request, so the parent's Approve can be retried and the kid is
   * never stuck "approved-but-denied" (permanent divergence).
   */
  const approveRequest = useCallback(
    async (targetPubkey: string) => {
      if (!kidPubkey) throw new Error('useTrustAssignments: no kid selected');
      await runApprovalSequence({
        enforced: featureTepp,
        writeTrust: () => setTrustLevel(kidPubkey, targetPubkey, 'interact'),
        publishGrant: () => {
          // Read the post-write snapshot so the grant carries the full
          // interact list (not just this one target).
          const fresh = getFamilySnapshot()?.trustAssignments?.[kidPubkey] ?? {};
          const sameTierExisting = Object.entries(fresh)
            .filter(([, tier]) => tier === 'interact')
            .map(([pubkey]) => pubkey)
            .filter((p) => p !== targetPubkey);
          return publishTierGrant(targetPubkey, 'interact', sameTierExisting);
        },
        clearRequest: () => clearTrustRequest(kidPubkey, targetPubkey),
      });
    },
    [kidPubkey, setTrustLevel, featureTepp, publishTierGrant, clearTrustRequest],
  );

  const setLevelIfUnassigned = useCallback(
    async (targetPubkey: string, level: KuboTrustLevel): Promise<boolean> => {
      if (!kidPubkey) throw new Error('useTrustAssignments: no kid selected');
      // No-downgrade: read the latest snapshot (not the closure-captured
      // render view, which can be stale within a session) and skip if the
      // target already carries any assignment.
      const existing = getFamilySnapshot()?.trustAssignments?.[kidPubkey]?.[targetPubkey];
      if (existing !== undefined) return false;
      await setLevel(targetPubkey, level);
      return true;
    },
    [kidPubkey, setLevel],
  );

  const setLevelsBatch = useCallback(
    async (targetPubkeys: string[], level: KuboTrustLevel): Promise<void> => {
      if (!kidPubkey) throw new Error('useTrustAssignments: no kid selected');
      // `extend` carries per-target semantics (the kid-target guard + extend
      // pairs); batching it isn't meaningful, so fall back to the single path.
      if (level === 'extend') {
        for (const pk of targetPubkeys) {
          await setLevelIfUnassigned(pk, level);
        }
        return;
      }

      // ONE localStorage write for all newly-assigned targets. Returns exactly
      // the pubkeys that were unassigned before (never downgrades existing
      // interact/extend), so an empty result means there is nothing to publish.
      const newlyAssigned = await setTrustLevelsBatch(kidPubkey, targetPubkeys, level);
      if (newlyAssigned.length === 0) return;

      if (!featureTepp) return;

      // ONE permission publish carrying the FULL same-tier list (prior entries
      // ∪ the batch we just wrote), then ONE state publish. The permission
      // event is replaceable by its d-tag (`${kid}:${tier}:npub`), so the
      // single publish supersedes any prior one — no amplification, no shrink.
      try {
        const fresh = getFamilySnapshot()?.trustAssignments?.[kidPubkey] ?? {};
        const fullTierList = Object.entries(fresh)
          .filter(([, tier]) => tier === level)
          .map(([pubkey]) => pubkey);
        // fullTierList is non-empty (it contains newlyAssigned), so [0] is safe.
        await publishTierGrant(fullTierList[0], level, fullTierList);
      } catch (err) {
        toast({
          title: 'TEPP publish failed',
          description: err instanceof Error ? err.message : String(err),
          variant: 'destructive',
        });
        // Keep the localStorage writes — the parent can re-toggle to retry.
      }
    },
    [kidPubkey, featureTepp, setLevelIfUnassigned, publishTierGrant, toast],
  );

  /**
   * Publish a same-tier npub revocation: re-publish the surviving list (without
   * `targetPubkey`) + state. THROWS on failure; callers decide whether to
   * swallow+toast (`clear`) or propagate (`retryRevocation`). Shared so the
   * revocation wire format is identical across the original clear and the
   * KUBO-169 retry path.
   */
  const publishTierRevocation = useCallback(
    async (targetPubkey: string, previousLevel: KuboTrustLevel): Promise<void> => {
      if (!kidPubkey) throw new Error('useTrustAssignments: no kid selected');
      // All three tiers are addressed by `${kidPubkey}:${tier}:npub`.
      //   - view     → kind 8712 (view npub)
      //   - interact → kind 8710 (interaction npub)
      //   - extend   → kind 8710 with an `extend` pair tag, on its own d-tag
      const kind =
        previousLevel === 'view'
          ? KIND_PERMISSION_VIEW_NPUB_A
          : KIND_PERMISSION_INTERACTION_NPUB_A;
      // Read post-write snapshot to compute the surviving same-tier list. The
      // closure-captured `kidAssignments` is stale relative to anything written
      // this session, and the cleared entry is already gone from localStorage.
      const fresh = getFamilySnapshot()?.trustAssignments?.[kidPubkey] ?? {};
      const sameTierRemaining = Object.entries(fresh)
        .filter(([pubkey, tier]) => tier === previousLevel && pubkey !== targetPubkey)
        .map(([pubkey]) => pubkey);
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
    },
    [kidPubkey, publishPermission, publishState],
  );

  const clear = useCallback(
    async (targetPubkey: string) => {
      if (!kidPubkey) throw new Error('useTrustAssignments: no kid selected');
      // Read previousLevel from the latest snapshot BEFORE the clear write.
      const previousLevel =
        getFamilySnapshot()?.trustAssignments?.[kidPubkey]?.[targetPubkey];
      await clearTrustLevel(kidPubkey, targetPubkey);

      if (!featureTepp || !previousLevel) {
        // featureTepp off (or nothing was assigned): localStorage clear is the
        // whole operation. Drop any stale revocation marker so we don't retry a
        // publish for a tier that's no longer enforced.
        if (previousLevel) void clearPendingRevocation(kidPubkey, targetPubkey);
        return;
      }

      try {
        await publishTierRevocation(targetPubkey, previousLevel);
        // Success → ensure no stale marker lingers (e.g. a prior failed clear of
        // the same target that later succeeded).
        await clearPendingRevocation(kidPubkey, targetPubkey);
      } catch (err) {
        toast({
          title: 'TEPP publish failed',
          description: err instanceof Error ? err.message : String(err),
          variant: 'destructive',
        });
        // KUBO-169: localStorage already removed the entry, but the wire still
        // admits the target. Record the failed revocation so the reconcile
        // phase retries the publish next session until the construct drops them.
        await recordPendingRevocation(kidPubkey, targetPubkey, previousLevel);
      }

      // KUBO-164 coherence: clearing a person's trust must also drop them from
      // the kid's kind-3 follow list, so the published list and the published
      // trust stay coherent (the reverse of the KUBO-148 "trust before follow"
      // model). Otherwise a stale follow lingers — and with KUBO-162 making
      // outgoing denies hard, the kid's next follow/unfollow would hard-deny on
      // that now-unadmitted entry. (The KUBO-164 gate delta is the read-side
      // backstop; this keeps the wire clean too.)
      //
      // `unfollowMany` (via `useFollowActions`) signs the kind-3 with the ACTIVE
      // user. The kid's kind-3 MUST be kid-signed, so we only unfollow when the
      // kid being cleared is the active login (true in the parent shell, where
      // the kid stays selected/active). If the kid isn't the active login we
      // SKIP rather than publish a kind-3 under the wrong key — the KUBO-164
      // gate delta still prevents the brick, and a later kid session reconcile
      // can converge the list. (No new infra; documented limitation.)
      if (shouldUnfollowOnClear(user?.pubkey, kidPubkey)) {
        try {
          await unfollowMany([targetPubkey]);
        } catch (err) {
          // Non-fatal: trust is already cleared. The follow entry just lingers;
          // the gate delta keeps publishes working until it's reconciled.
          console.warn('clear: kid-3 unfollow failed', err);
        }
      }
    },
    [kidPubkey, clearTrustLevel, featureTepp, publishTierRevocation, toast, user?.pubkey, unfollowMany],
  );

  /**
   * KUBO-169 reconcile primitive: publish a grant covering exactly `members` at
   * `level`, using the construct (caller-computed via `computeMissingGrants`) —
   * NOT the localStorage-change check — as the oracle. ONE permission + ONE
   * state publish for the union of (current same-tier list ∪ members). Throws
   * on failure so the reconcile guard can retry next session.
   */
  const publishMissingGrants = useCallback(
    async (members: string[], level: KuboTrustLevel): Promise<void> => {
      if (!kidPubkey) throw new Error('useTrustAssignments: no kid selected');
      if (!featureTepp || members.length === 0) return;
      // Union of the currently-recorded same-tier list and the members we're
      // (re-)admitting. The members are already in localStorage at this tier
      // (reconcile diffs localStorage-granted-but-not-on-wire), so this is
      // typically just the current full list — but we union defensively.
      const fresh = getFamilySnapshot()?.trustAssignments?.[kidPubkey] ?? {};
      const fullTierList = [
        ...new Set([
          ...Object.entries(fresh)
            .filter(([, tier]) => tier === level)
            .map(([pubkey]) => pubkey),
          ...members,
        ]),
      ];
      if (fullTierList.length === 0) return;
      // ONE publish for the whole union (the permission event is replaceable by
      // its d-tag), then ONE state publish. No per-member amplification.
      await publishTierGrant(fullTierList[0], level, fullTierList);
    },
    [kidPubkey, featureTepp, publishTierGrant],
  );

  /**
   * KUBO-169 reconcile primitive: retry a previously-failed revocation. The
   * localStorage entry was already removed by `clear`, so we just re-publish the
   * surviving same-tier list (without the target) + state. On success clear the
   * pendingRevocations marker; on failure propagate so the marker survives.
   */
  const retryRevocation = useCallback(
    async (targetPubkey: string, previousLevel: KuboTrustLevel): Promise<void> => {
      if (!kidPubkey) throw new Error('useTrustAssignments: no kid selected');
      if (!featureTepp) return;
      await publishTierRevocation(targetPubkey, previousLevel);
      await clearPendingRevocation(kidPubkey, targetPubkey);
    },
    [kidPubkey, featureTepp, publishTierRevocation],
  );

  const clearPendingRevocationMarker = useCallback(
    async (targetPubkey: string): Promise<void> => {
      if (!kidPubkey) return;
      await clearPendingRevocation(kidPubkey, targetPubkey);
    },
    [kidPubkey],
  );

  return {
    get,
    setLevel,
    setLevelIfUnassigned,
    setLevelsBatch,
    clear,
    approveRequest,
    publishMissingGrants,
    retryRevocation,
    clearPendingRevocationMarker,
  };
}
