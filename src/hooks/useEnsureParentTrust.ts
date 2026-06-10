import { useEffect } from 'react';
import { useNostr } from '@nostrify/react';

import { useAppContext } from '@/hooks/useAppContext';
import { useFollowActions } from '@/hooks/useFollowActions';
import { fetchPacksByAtags } from '@/hooks/useFollowPacks';
import { getFamilySnapshot, useKuboFamily } from '@/hooks/useKuboFamily';
import { MAX_PACK_AUTHORS } from '@/hooks/useKidFeed';
import { useKuboTeppConstruct } from '@/hooks/useKuboTeppConstruct';
import { useParentSigner } from '@/hooks/useParentSigner';
import {
  computeMissingGrants,
  constructAdmitsAtTier,
  useTrustAssignments,
} from '@/hooks/useTrustAssignments';
import {
  KIND_PERMISSION_INTERACTION_NPUB_A,
  KIND_PERMISSION_INTERACTION_NPUB_B,
} from '@/lib/tepp/kinds';
import type { KuboTrustLevel } from '@/hooks/useKuboFamily';
import type { Construct } from '@/lib/tepp/types';

/**
 * Per-kid, per-phase reconcile guard. Module-level (not a ref) so it survives
 * re-renders/remounts within the session. Keyed per phase so a deferred phase
 * (construct not loaded, parent logged out) can retry independently while a
 * completed phase isn't redone.
 */
interface ReconcileGuard {
  parent: boolean;
  packs: boolean;
  /** KUBO-169: construct-vs-localStorage divergence reconcile (phase 3). */
  divergence: boolean;
}

const reconciledKids = new Map<string, ReconcileGuard>();

function guardFor(kid: string): ReconcileGuard {
  let g = reconciledKids.get(kid);
  if (!g) {
    g = { parent: false, packs: false, divergence: false };
    reconciledKids.set(kid, g);
  }
  return g;
}

/** Test-only: reset the once-per-session reconcile guard. */
export function __resetEnsureParentTrustGuard(): void {
  reconciledKids.clear();
}

/**
 * KUBO-169 pure decision for a single pending revocation in phase 3. The
 * construct is the oracle: if it STILL admits the target, the original
 * revocation publish never landed → `retry`. If it no longer admits the target,
 * the wire is already correct (a later session, a manual re-clear, or a
 * superseding publish fixed it) → just `clear-marker`. Extracted so the branch
 * is unit-testable without `renderHook` (repo idiom).
 */
export function decideRevocationAction(
  construct: Construct,
  targetPubkey: string,
  previousLevel: KuboTrustLevel,
): 'retry' | 'clear-marker' {
  return constructAdmitsAtTier(construct, targetPubkey, previousLevel)
    ? 'retry'
    : 'clear-marker';
}

/** True if `pubkey` appears in any interaction npub-permission entry of the construct. */
function constructHasInteract(construct: Construct, pubkey: string): boolean {
  const lower = pubkey.toLowerCase();
  return construct.entries.some(
    (e) =>
      (e.kind === KIND_PERMISSION_INTERACTION_NPUB_A ||
        e.kind === KIND_PERMISSION_INTERACTION_NPUB_B) &&
      (e.items as Array<{ pubkey: string }>).some((i) => i?.pubkey === lower),
  );
}

/**
 * Reconcile a kid's trust domain + kind-3 follow list against the intent that
 * was seeded by raw localStorage writes at kid-creation time (KUBO-147).
 *
 * Two phases, run once per kid per session, keyed on the selected kid:
 *
 *  1. **Parent** — `addKid`/first-kid `setFamily` seed `trustAssignments[kid]
 *     [parent]='interact'` in localStorage but do NOT publish. When featureTepp
 *     is on, the construct (built from PUBLISHED permission events) is missing
 *     the parent. We detect "interact in localStorage but absent from the
 *     construct's interaction entries" and publish via `setLevel`.
 *
 *  2. **Packs** — the default pack (and any pack toggled while featureTepp was
 *     off) is seeded into `feedSources.packs` bypassing `useAddFeedPack`, so its
 *     members were never granted view trust nor added to the kid's kind-3. We
 *     expand every enabled pack, batch-grant `view` to untrusted members, and
 *     follow them into the kid's kind-3.
 *
 * Mount once high in the parent shell, keyed on the selected kid.
 */
export function useEnsureParentTrust(kidPubkey: string | undefined): void {
  const { nostr } = useNostr();
  const { family } = useKuboFamily();
  const { config } = useAppContext();
  const { user: parentUser } = useParentSigner();
  const trust = useTrustAssignments(kidPubkey);
  const { followMany } = useFollowActions();
  const { construct, loading: constructLoading } = useKuboTeppConstruct(kidPubkey);

  const parentPubkey = family?.parentPubkey;
  const featureTepp = !!config.feedSettings.featureTepp;

  useEffect(() => {
    if (!kidPubkey || !parentPubkey) return;
    const guard = guardFor(kidPubkey);

    // ── Phase 1: parent reconcile ─────────────────────────────────────────
    if (!guard.parent) {
      const snapLevel = getFamilySnapshot()?.trustAssignments?.[kidPubkey]?.[parentPubkey];
      if (featureTepp) {
        // Need the parent signer to publish, and a definitively-loaded construct
        // to know whether the parent is already on the wire. Defer otherwise.
        if (!parentUser || constructLoading) {
          // leave guard.parent = false → retry on a later render
        } else if (snapLevel === 'interact' && construct && !constructHasInteract(construct, parentPubkey)) {
          // Interact in localStorage but absent from the published construct →
          // publish it. setLevel does the full localStorage+permission+state path.
          guard.parent = true;
          void trust.setLevel(parentPubkey, 'interact').catch((err) => {
            guard.parent = false; // allow retry next session
            console.warn('reconcile: parent publish failed', err);
          });
        } else {
          // Either parent already published, or deliberately removed/downgraded
          // (snapLevel !== 'interact') — nothing to do; mark complete.
          guard.parent = true;
        }
      } else {
        // featureTepp off: nothing to publish. The localStorage seed already
        // shows the parent in Trust → People. Complete.
        guard.parent = true;
      }
    }

    // ── Phase 2: pack reconcile ───────────────────────────────────────────
    if (!guard.packs) {
      // Publishing the per-pack view grant needs the parent signer when
      // featureTepp is on; defer if absent so a later session completes it.
      if (featureTepp && !parentUser) {
        // leave guard.packs = false → retry
      } else {
        const enabledPacks = getFamilySnapshot()?.feedSources?.[kidPubkey]?.packs ?? [];
        if (enabledPacks.length === 0) {
          guard.packs = true; // nothing to reconcile
        } else {
          guard.packs = true; // optimistic; reset on failure below
          void (async () => {
            try {
              const signal = AbortSignal.timeout(8000);
              const packMap = await fetchPacksByAtags(nostr, enabledPacks, signal);
              const members = new Set<string>();
              outer: for (const pack of packMap.values()) {
                for (const [name, value] of pack.event.tags) {
                  if (name === 'p' && value && value !== kidPubkey && value !== parentPubkey) {
                    members.add(value);
                    if (members.size >= MAX_PACK_AUTHORS) break outer;
                  }
                }
              }
              if (members.size === 0) return;
              const memberList = [...members];

              // KUBO-175: only FOLLOW members we are granting trust to for the
              // FIRST time — i.e. those with no existing trust assignment. The
              // old code re-followed every pack member every session, which
              // silently re-added anyone the parent had manually unfollowed
              // (the kid's kind-3 carries that manual removal). A member who was
              // already trust-granted earlier is intentionally NOT re-followed.
              //
              // Snapshot the assignments BEFORE the batch grant below (which
              // would otherwise mark every member "assigned" and leave nothing
              // first-time).
              //
              // Limitation: there is no dedicated "previously removed" signal,
              // so "already trust-assigned" is the proxy for "we've already
              // followed this member once." A brand-new member added to an
              // enabled pack is still followed on the next reconcile.
              const existing = getFamilySnapshot()?.trustAssignments?.[kidPubkey] ?? {};
              const firstTimeMembers = memberList.filter((pk) => existing[pk] == null);

              // Grant view to untrusted members (setLevelsBatch skips
              // already-assigned and no-ops when nothing is new).
              await trust.setLevelsBatch(memberList, 'view');

              // KUBO-169: setLevelsBatch early-returns when localStorage didn't
              // change — so pack members assigned WHILE TEPP WAS OFF (localStorage
              // written, never published), or whose earlier batch publish failed,
              // are on disk but absent from the construct forever. Diff this pack's
              // members against the CONSTRUCT (the trustworthy oracle) and publish
              // exactly the ones it doesn't yet admit at view — bypassing the
              // localStorage-changed check. No-ops (and publishes nothing) when the
              // construct already matches. Only runs with a definitely-loaded
              // construct; otherwise phase 3 below converges later.
              if (featureTepp && construct) {
                const memberSet: Record<string, KuboTrustLevel> = {};
                for (const pk of memberList) memberSet[pk] = 'view';
                const missing = computeMissingGrants(memberSet, construct, 'view');
                if (missing.length > 0) {
                  await trust.publishMissingGrants(missing, 'view');
                }
              }

              if (firstTimeMembers.length > 0) await followMany(firstTimeMembers);
            } catch (err) {
              guard.packs = false; // allow retry next session
              console.warn('reconcile: pack reconcile failed', err);
            }
          })();
        }
      }
    }

    // ── Phase 3: full construct-vs-localStorage divergence reconcile (KUBO-169) ─
    //
    // Covers the divergence paths the pack phase can't: individual profiles
    // added via useAddFeedProfile whose grant publish failed, the parent grant
    // if phase 1's setLevel publish failed, and failed REVOCATIONS (a clear
    // whose permission publish failed — localStorage entry gone, wire still
    // admits).
    //
    // The CONSTRUCT is the oracle. We diff ALL of trustAssignments[kid] against
    // it per tier and re-publish only the missing grants (no churn when they
    // match), then retry every pendingRevocation until the construct drops it.
    // Requires a definitely-loaded construct + the parent signer; defers (guard
    // stays false) otherwise so a later session converges.
    if (!guard.divergence) {
      if (!featureTepp) {
        guard.divergence = true; // nothing on the wire to reconcile against
      } else if (!parentUser || constructLoading || !construct) {
        // leave guard.divergence = false → retry on a later render/session
      } else {
        guard.divergence = true; // optimistic; reset on failure below
        const loadedConstruct = construct;
        void (async () => {
          try {
            const snapshot = getFamilySnapshot();
            const assignments = snapshot?.trustAssignments?.[kidPubkey];

            // Re-publish grants the construct is missing, per tier. ONE batch
            // publish per tier (publishMissingGrants), not per-member.
            // computeMissingGrants keys on the recorded tier, so interact/view/
            // extend are reconciled separately and never cross-clobber.
            for (const tier of ['interact', 'view', 'extend'] as KuboTrustLevel[]) {
              const missing = computeMissingGrants(assignments, loadedConstruct, tier);
              if (missing.length > 0) {
                await trust.publishMissingGrants(missing, tier);
              }
            }

            // Retry failed revocations until the construct no longer admits the
            // target. retryRevocation re-publishes the shrunken list + state and
            // clears the marker on success; a target the construct already
            // dropped just gets its stale marker cleared.
            const pending = snapshot?.pendingRevocations?.[kidPubkey] ?? {};
            for (const [target, previousLevel] of Object.entries(pending)) {
              const action = decideRevocationAction(loadedConstruct, target, previousLevel);
              if (action === 'retry') {
                await trust.retryRevocation(target, previousLevel);
              } else {
                await trust.clearPendingRevocationMarker(target);
              }
            }
          } catch (err) {
            guard.divergence = false; // allow retry next session
            console.warn('reconcile: divergence reconcile failed', err);
          }
        })();
      }
    }
  }, [
    kidPubkey,
    parentPubkey,
    featureTepp,
    parentUser,
    construct,
    constructLoading,
    nostr,
    trust,
    followMany,
  ]);
}
