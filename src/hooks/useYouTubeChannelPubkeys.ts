import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { nip19 } from 'nostr-tools';

import {
  EMPTY_FEED_SOURCES,
  getFamilySnapshot,
  subscribeFamily,
  type YouTubeChannelRef,
} from '@/hooks/useKuboFamily';

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
 * Pure core (exported for unit testing): collect the hex pubkeys for a list of
 * YouTube channel refs, skipping any with an undecodable npub.
 */
export function collectChannelPubkeys(refs: YouTubeChannelRef[]): Set<string> {
  const set = new Set<string>();
  for (const ref of refs) {
    const pubkey = npubToPubkey(ref.npub);
    if (pubkey) set.add(pubkey);
  }
  return set;
}

/**
 * Pure core (exported for unit testing): the "real Profiles" view of a kind-3
 * follow list — every followed pubkey EXCEPT those that are YouTube channels.
 * Order-preserving so the Following list stays stable.
 */
export function excludeChannelPubkeys(
  followed: string[],
  channelPubkeys: Set<string>,
): string[] {
  return followed.filter((pk) => !channelPubkeys.has(pk));
}

/**
 * KUBO-207: the set of hex pubkeys that are bridge-derived YouTube channels for
 * a given kid.
 *
 * A YouTube channel is added by following its bridge npub in the kid's kind-3
 * AND granting it `view` trust (see `useYouTubeChannels`). That follow is what
 * makes the channel's videos flow into the feed — but it also means the channel
 * npub shows up in the raw kind-3 follow list. The "Profiles" feed-source is
 * the kid's kind-3 follow list, so without filtering, every YouTube channel
 * also renders as a Profile.
 *
 * This hook exposes the channel pubkeys so the Profiles tile/page can exclude
 * them: channels are managed ONLY under "YouTube Channels", and Profiles shows
 * only people the parent followed directly. We key off the persisted
 * `youtube[]` refs (not trust level) so a *disabled* channel whose follow
 * lingers is still recognised as a channel and stays out of Profiles.
 *
 * Subscribes to the same family store as `useYouTubeChannels`, so it stays in
 * sync when channels are added/forgotten.
 */
export function useYouTubeChannelPubkeys(kidPubkey: string | undefined): Set<string> {
  const getSnap = useCallback((): YouTubeChannelRef[] => {
    if (!kidPubkey) return EMPTY_FEED_SOURCES.youtube;
    return (
      getFamilySnapshot()?.feedSources?.[kidPubkey]?.youtube ??
      EMPTY_FEED_SOURCES.youtube
    );
  }, [kidPubkey]);
  const refs = useSyncExternalStore(subscribeFamily, getSnap, getSnap);

  return useMemo(() => collectChannelPubkeys(refs), [refs]);
}
