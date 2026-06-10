import { useCallback } from 'react';

import { useFollowActions } from '@/hooks/useFollowActions';
import { useTrustAssignments } from '@/hooks/useTrustAssignments';

export interface UseAddFeedProfileReturn {
  /** Whether the underlying follow/unfollow mutation is in progress. */
  isPending: boolean;
  /**
   * Add a profile to the active kid's feed: follow them (kid's kind-3) AND
   * grant `view`-only trust if they're currently unassigned. Never downgrades
   * someone already at interact/extend, and never touches the parent's entry.
   */
  addProfile: (pubkey: string) => Promise<void>;
  /**
   * Remove a profile from the feed: unfollow only. The trust entry is left in
   * place (additive-only removal, KUBO-147) — the parent prunes it explicitly
   * in Trust → People if they want to revoke.
   */
  removeProfile: (pubkey: string) => Promise<void>;
}

/**
 * Intent-scoped composite for the Profiles feed-source page (KUBO-147).
 *
 * Wraps `useFollowActions` + `useTrustAssignments` so that "add this profile
 * to my kid's feed" also grants the view-only trust the kid needs to actually
 * see that profile's content once `featureTepp` is on. Lives here — not inside
 * `follow()` — because `follow()` is generic (used on profile pages etc., with
 * no notion of a kid's trust domain), so a trust side-effect there would
 * over-fire.
 */
export function useAddFeedProfile(
  kidPubkey: string | undefined,
): UseAddFeedProfileReturn {
  const { follow, unfollow, isPending } = useFollowActions();
  const trust = useTrustAssignments(kidPubkey);

  const addProfile = useCallback(
    async (pubkey: string) => {
      // Grant view-only trust FIRST (no-downgrade), then follow. The follow
      // publishes the kid's kind-3, which the TEPP gate evaluates against the
      // construct; granting+publishing trust first means the construct admits
      // this pubkey by the time the kind-3 publish is gated. A trust failure
      // must not block the follow — setLevelIfUnassigned keeps the localStorage
      // write, and the kind-3 gate now treats follow lists at the view
      // threshold (KUBO-147), so the follow succeeds regardless.
      //
      // KUBO-169: previously, a FAILED grant publish left localStorage written
      // but the construct missing this pubkey FOREVER — setLevelIfUnassigned
      // returns false on every later attempt (no-downgrade), so nothing retried.
      // That permanent divergence is now self-healing: useEnsureParentTrust
      // phase 3 diffs ALL of trustAssignments[kid] against the construct and
      // re-publishes anyone it doesn't yet admit, so a transiently-failed grant
      // here converges on the next parent session.
      if (kidPubkey) {
        try {
          await trust.setLevelIfUnassigned(pubkey, 'view');
        } catch (err) {
          console.warn('useAddFeedProfile: trust grant failed', err);
        }
      }
      await follow(pubkey);
    },
    [follow, trust, kidPubkey],
  );

  const removeProfile = useCallback(
    async (pubkey: string) => {
      await unfollow(pubkey);
      // Intentionally leave the trust entry — additive-only removal.
    },
    [unfollow],
  );

  return { isPending, addProfile, removeProfile };
}
