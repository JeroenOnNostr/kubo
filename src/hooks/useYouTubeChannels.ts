import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { nip19 } from 'nostr-tools';

import { useFollowActions } from '@/hooks/useFollowActions';
import { useTrustAssignments } from '@/hooks/useTrustAssignments';
import {
  addYouTubeChannelRef,
  EMPTY_FEED_SOURCES,
  getFamilySnapshot,
  removeYouTubeChannelRef,
  subscribeFamily,
  type YouTubeChannelRef,
} from '@/hooks/useKuboFamily';

/** A YouTube channel ref plus its current derived enabled state. */
export interface YouTubeChannelEntry extends YouTubeChannelRef {
  /** True when the channel's npub currently holds `view` trust. */
  enabled: boolean;
}

export interface UseYouTubeChannelsReturn {
  /** All persisted channels for this kid, with derived enabled state. */
  channels: YouTubeChannelEntry[];
  /** Channels currently enabled (trust === 'view'). */
  active: YouTubeChannelEntry[];
  /** Channels persisted but disabled (trust none/absent). */
  removed: YouTubeChannelEntry[];
  /** Whether a follow/unfollow mutation is in progress. */
  isPending: boolean;
  /**
   * Add a channel to the kid's feed: persist the ref AND grant the npub `view`
   * trust + follow it (kid's kind-3). Reuses the same trust+follow grant path as
   * `useAddFeedProfile` (KUBO-147). Idempotent on npub.
   */
  addChannel: (ref: YouTubeChannelRef) => Promise<void>;
  /**
   * Enable/disable a channel WITHOUT dropping its ref. on=true grants `view` +
   * follows; on=false clears trust (→ none) + unfollows. The ref stays in
   * `youtube[]` either way so it can be re-enabled without a fresh search.
   */
  setEnabled: (npub: string, on: boolean) => Promise<void>;
  /**
   * Forget a channel entirely: remove the ref AND clear trust / unfollow. This
   * is the only op that drops the persisted record.
   */
  forgetChannel: (npub: string) => Promise<void>;
}

/** Decode an npub to a hex pubkey, or null if it isn't a valid npub. */
function npubToPubkey(npub: string): string | null {
  try {
    const decoded = nip19.decode(npub);
    return decoded.type === 'npub' ? decoded.data : null;
  } catch {
    return null;
  }
}

/**
 * Intent-scoped composite for the YouTube Channels feed-source page (KUBO-YT).
 *
 * Mirrors `useAddFeedProfile`: a YouTube channel becomes visible to the kid by
 * following its bridge-derived npub AND granting that npub `view` trust (so the
 * TEPP query-scoping admits the channel's kind-21 video events). The persisted
 * `youtube[]` ref tracks which channels the parent has added so they can be
 * disabled/re-enabled without re-searching the DVM.
 *
 * Enabled-state is DERIVED, not stored: a channel is enabled iff its npub holds
 * `view` trust. Disable flips trust to none (and unfollows) but leaves the ref.
 */
export function useYouTubeChannels(
  kidPubkey: string | undefined,
): UseYouTubeChannelsReturn {
  const { follow, unfollow, isPending } = useFollowActions();
  const trust = useTrustAssignments(kidPubkey);

  // Subscribe to the same family store the rest of the feed-sources read.
  const getSnap = useCallback((): YouTubeChannelRef[] => {
    if (!kidPubkey) return EMPTY_FEED_SOURCES.youtube;
    return getFamilySnapshot()?.feedSources?.[kidPubkey]?.youtube ?? EMPTY_FEED_SOURCES.youtube;
  }, [kidPubkey]);
  const refs = useSyncExternalStore(subscribeFamily, getSnap, getSnap);

  const channels = useMemo<YouTubeChannelEntry[]>(
    () =>
      refs.map((ref) => ({
        ...ref,
        enabled: trust.get(npubToPubkey(ref.npub) ?? '') === 'view',
      })),
    [refs, trust],
  );

  const active = useMemo(() => channels.filter((c) => c.enabled), [channels]);
  const removed = useMemo(() => channels.filter((c) => !c.enabled), [channels]);

  /** Grant `view` trust + follow the channel npub (the KUBO-147 grant path). */
  const grant = useCallback(
    async (npub: string) => {
      const pubkey = npubToPubkey(npub);
      if (!pubkey || !kidPubkey) return;
      // Grant view-only trust FIRST (no-downgrade), then follow — same ordering
      // as useAddFeedProfile. The kid's kind-3 publish is TEPP-gated; KUBO-201
      // makes the record-list gate honor THIS just-written localStorage view
      // grant (the guardian's intent) so the follow isn't denied by a construct
      // that hasn't yet refetched the just-published kind-8712 (the
      // construct-refresh race). A trust failure must not block the follow.
      try {
        await trust.setLevelIfUnassigned(pubkey, 'view');
      } catch (err) {
        console.warn('useYouTubeChannels: trust grant failed', err);
      }
      // A follow-publish failure (TEPP deny in some edge case, or a relay flap)
      // must NOT bubble up as a hard "couldn't add channel" error: the ref is
      // already persisted and the trust write succeeded, so the channel is added
      // optimistically and KUBO-169 phase-3 reconcile converges the grant +
      // follow on the next parent session. This mirrors how useAddFeedProfile is
      // consumed on the Profiles page (the add is fire-and-forget there).
      try {
        await follow(pubkey);
      } catch (err) {
        console.warn('useYouTubeChannels: follow failed (will reconcile)', err);
      }
    },
    [follow, trust, kidPubkey],
  );

  /** Clear trust (→ none) + unfollow the channel npub. */
  const revoke = useCallback(
    async (npub: string) => {
      const pubkey = npubToPubkey(npub);
      if (!pubkey || !kidPubkey) return;
      // clear() publishes the TEPP revocation AND unfollows the kid's kind-3
      // when the kid is the active login (KUBO-164) — exactly the disable path.
      try {
        await trust.clear(pubkey);
      } catch (err) {
        console.warn('useYouTubeChannels: trust clear failed', err);
      }
      // clear() only unfollows when the kid is the active signer; do an explicit
      // unfollow too so the kind-3 is dropped on the parent shell as well. It is
      // a no-op when the pubkey isn't followed.
      try {
        await unfollow(pubkey);
      } catch (err) {
        console.warn('useYouTubeChannels: unfollow failed', err);
      }
    },
    [trust, unfollow, kidPubkey],
  );

  const addChannel = useCallback(
    async (ref: YouTubeChannelRef) => {
      if (!kidPubkey) return;
      await addYouTubeChannelRef(kidPubkey, ref);
      await grant(ref.npub);
    },
    [kidPubkey, grant],
  );

  const setEnabled = useCallback(
    async (npub: string, on: boolean) => {
      if (on) {
        await grant(npub);
      } else {
        await revoke(npub);
      }
    },
    [grant, revoke],
  );

  const forgetChannel = useCallback(
    async (npub: string) => {
      if (!kidPubkey) return;
      await revoke(npub);
      await removeYouTubeChannelRef(kidPubkey, npub);
    },
    [kidPubkey, revoke],
  );

  return { channels, active, removed, isPending, addChannel, setEnabled, forgetChannel };
}
