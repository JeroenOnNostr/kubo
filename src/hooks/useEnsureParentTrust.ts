import { useEffect } from 'react';
import { useNostr } from '@nostrify/react';

import { useAppContext } from '@/hooks/useAppContext';
import { useFollowActions } from '@/hooks/useFollowActions';
import { fetchPacksByAtags } from '@/hooks/useFollowPacks';
import { getFamilySnapshot, useKuboFamily } from '@/hooks/useKuboFamily';
import { MAX_PACK_AUTHORS } from '@/hooks/useKidFeed';
import { useKuboTeppConstruct } from '@/hooks/useKuboTeppConstruct';
import { useParentSigner } from '@/hooks/useParentSigner';
import { useTrustAssignments } from '@/hooks/useTrustAssignments';
import {
  KIND_PERMISSION_INTERACTION_NPUB_A,
  KIND_PERMISSION_INTERACTION_NPUB_B,
} from '@/lib/tepp/kinds';
import type { Construct } from '@/lib/tepp/types';

/**
 * Per-kid, per-phase reconcile guard. Module-level (not a ref) so it survives
 * re-renders/remounts within the session. Keyed per phase so a deferred phase
 * (construct not loaded, parent logged out) can retry independently while a
 * completed phase isn't redone.
 */
const reconciledKids = new Map<string, { parent: boolean; packs: boolean }>();

function guardFor(kid: string): { parent: boolean; packs: boolean } {
  let g = reconciledKids.get(kid);
  if (!g) {
    g = { parent: false, packs: false };
    reconciledKids.set(kid, g);
  }
  return g;
}

/** Test-only: reset the once-per-session reconcile guard. */
export function __resetEnsureParentTrustGuard(): void {
  reconciledKids.clear();
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

              // Grant view to untrusted members (setLevelsBatch skips
              // already-assigned and no-ops when nothing is new), then follow
              // them into the kid's kind-3 (followMany dedups + single publish).
              await trust.setLevelsBatch(memberList, 'view');
              await followMany(memberList);
            } catch (err) {
              guard.packs = false; // allow retry next session
              console.warn('reconcile: pack reconcile failed', err);
            }
          })();
        }
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
