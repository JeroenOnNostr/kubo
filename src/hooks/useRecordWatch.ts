import { useCallback } from 'react';

import { useSelectedKid } from '@/hooks/useSelectedKid';
import { recordWatch as persistWatch, type WatchEntry } from '@/lib/watchHistoryStore';

type WatchSnapshot = Omit<WatchEntry, 'viewedAt'>;

/**
 * Records a kid-side video play into watch history, keyed by whichever kid
 * is the active Nostr signer (`useSelectedKid`). Returns a stable callback
 * that no-ops when there's no active kid — i.e. when the parent is browsing
 * under their own signer, nothing gets logged. This is the single gate that
 * keeps parent-time and kid-time separated in the local store.
 */
export function useRecordWatch(): (snapshot: WatchSnapshot) => void {
  const kid = useSelectedKid();
  const kidPubkey = kid?.pubkey;

  return useCallback(
    (snapshot) => {
      if (!kidPubkey) return;
      const entry: WatchEntry = {
        ...snapshot,
        viewedAt: Math.floor(Date.now() / 1000),
      };
      void persistWatch(kidPubkey, entry);
    },
    [kidPubkey],
  );
}
