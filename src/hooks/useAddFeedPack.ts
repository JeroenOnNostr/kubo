import { useCallback } from 'react';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';

import { useFollowActions } from '@/hooks/useFollowActions';
import { fetchPacksByAtags } from '@/hooks/useFollowPacks';
import { MAX_PACK_AUTHORS } from '@/hooks/useKidFeed';
import { useKidFeedSources } from '@/hooks/useKidFeedSources';
import { useKuboFamily } from '@/hooks/useKuboFamily';
import { useTrustAssignments } from '@/hooks/useTrustAssignments';

export interface UseAddFeedPackReturn {
  /**
   * Toggle a follow pack on/off for the active kid's feed.
   *
   * On ADD: grant `view`-only trust to every pack member (batched: one
   * localStorage write + one TEPP permission/state publish, KUBO-147) AND add
   * them to the kid's kind-3 follow list (one publish via `followMany`).
   * On REMOVE: drop the members from the kid's kind-3 follow list, but LEAVE
   * member trust in place (additive-only removal — the parent prunes trust
   * manually in Trust → People). Pass `packEvent` when the caller already holds
   * it (the Enabled/Browse rows do) to avoid a redundant member fetch.
   */
  togglePack: (atag: string, packEvent?: NostrEvent) => Promise<void>;
}

/** Read the deduped, capped list of member pubkeys (`p` tags) from a pack event. */
function packMembers(event: NostrEvent): string[] {
  const out = new Set<string>();
  for (const [name, value] of event.tags) {
    if (name === 'p' && value) {
      out.add(value);
      if (out.size >= MAX_PACK_AUTHORS) break;
    }
  }
  return Array.from(out);
}

/**
 * Intent-scoped composite for the Packs feed-source page (KUBO-147): toggling
 * a follow pack into a kid's feed also grants the kid view-only trust over the
 * pack's members, so the TEPP construct admits their content once the feature
 * flag is on.
 */
export function useAddFeedPack(
  kidPubkey: string | undefined,
): UseAddFeedPackReturn {
  const { nostr } = useNostr();
  const { family } = useKuboFamily();
  const { sources, togglePack: baseTogglePack } = useKidFeedSources(kidPubkey ?? null);
  const trust = useTrustAssignments(kidPubkey);
  const { followMany, unfollowMany } = useFollowActions();

  const togglePack = useCallback(
    async (atag: string, packEvent?: NostrEvent) => {
      const isAdding = !sources.packs.includes(atag);
      await baseTogglePack(atag);

      if (!kidPubkey) return;

      try {
        // Prefer the caller-supplied event (no extra round-trip); else fetch.
        let event = packEvent;
        if (!event) {
          const map = await fetchPacksByAtags(nostr, [atag]);
          event = map.get(atag)?.event;
        }
        if (!event) return; // Indexing gap / timeout — feed still expands it; nothing to sync this round.

        const parentPubkey = family?.parentPubkey;
        const members = packMembers(event).filter(
          (pk) => pk !== kidPubkey && pk !== parentPubkey,
        );
        if (members.length === 0) return;

        if (isAdding) {
          // Grant view trust BEFORE following so the construct admits these
          // members by the time the kind-3 publish is gated. setLevelsBatch
          // skips already-assigned members (no-downgrade) and does one
          // localStorage write + one TEPP publish for the whole batch.
          await trust.setLevelsBatch(members, 'view');
          await followMany(members);
        } else {
          // Removal: drop members from the kid's kind-3 follow list, but leave
          // their trust entries in place (additive-only removal).
          // KUBO-175: only unfollow members that are NOT also in another
          // still-enabled pack — otherwise removing one pack would unfollow a
          // creator the kid still gets via a different enabled pack. Compute the
          // union of the OTHER enabled packs' members first and subtract it.
          const otherAtags = sources.packs.filter((a) => a !== atag);
          const keep = new Set<string>();
          if (otherAtags.length > 0) {
            const otherPacks = await fetchPacksByAtags(nostr, otherAtags);
            for (const a of otherAtags) {
              const ev = otherPacks.get(a)?.event;
              if (ev) for (const pk of packMembers(ev)) keep.add(pk);
            }
          }
          const toUnfollow = members.filter((pk) => !keep.has(pk));
          if (toUnfollow.length > 0) await unfollowMany(toUnfollow);
        }
      } catch (err) {
        // The feed-source toggle already succeeded; a failed trust/follow sync
        // must not surface as a toggle failure. The parent can re-toggle.
        console.warn('useAddFeedPack: trust/follow sync failed', err);
      }
    },
    [sources.packs, baseTogglePack, kidPubkey, nostr, family?.parentPubkey, trust, followMany, unfollowMany],
  );

  return { togglePack };
}
