import { useCallback, useSyncExternalStore } from 'react';
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector';

import {
  EMPTY_FEED_SOURCES,
  getFamilySnapshot,
  type KidFeedSources,
  subscribeFamily,
  toggleFeedCommunity,
  toggleFeedPack,
  toggleFeedRelay,
} from './useKuboFamily';

/**
 * Per-kid feed sources. Reads/writes the same KuboFamily store as
 * useKuboFamily() but scoped to one kid's pubkey.
 *
 * See KUBO-042 and plan mitigation M4 for the rationale behind
 * useKidFeedSourcesSelector — it avoids re-rendering the parent layout
 * on unrelated family mutations.
 */
export function useKidFeedSources(kidPubkey: string | null): {
  sources: KidFeedSources;
  toggleRelay: (url: string) => Promise<void>;
  toggleCommunity: (atag: string) => Promise<void>;
  togglePack: (atag: string) => Promise<void>;
} {
  const family = useSyncExternalStore(
    subscribeFamily,
    getFamilySnapshot,
    getFamilySnapshot,
  );

  const sources = kidPubkey
    ? family?.feedSources?.[kidPubkey] ?? EMPTY_FEED_SOURCES
    : EMPTY_FEED_SOURCES;

  const toggleRelay = useCallback(
    async (url: string) => {
      if (!kidPubkey) return;
      await toggleFeedRelay(kidPubkey, url);
    },
    [kidPubkey],
  );
  const toggleCommunity = useCallback(
    async (atag: string) => {
      if (!kidPubkey) return;
      await toggleFeedCommunity(kidPubkey, atag);
    },
    [kidPubkey],
  );
  const togglePack = useCallback(
    async (atag: string) => {
      if (!kidPubkey) return;
      await toggleFeedPack(kidPubkey, atag);
    },
    [kidPubkey],
  );

  return { sources, toggleRelay, toggleCommunity, togglePack };
}

/**
 * Selector variant — re-renders only when the selected slice actually
 * changes (Object.is by default, or a custom `isEqual`). Use this in the
 * parent tile grid so toggling one source type doesn't re-render the chrome
 * or the other tiles.
 */
export function useKidFeedSourcesSelector<T>(
  kidPubkey: string | null,
  selector: (sources: KidFeedSources) => T,
  isEqual?: (a: T, b: T) => boolean,
): T {
  const getSnap = useCallback((): KidFeedSources => {
    if (!kidPubkey) return EMPTY_FEED_SOURCES;
    const fam = getFamilySnapshot();
    return fam?.feedSources?.[kidPubkey] ?? EMPTY_FEED_SOURCES;
  }, [kidPubkey]);

  return useSyncExternalStoreWithSelector<KidFeedSources, T>(
    subscribeFamily,
    getSnap,
    getSnap,
    selector,
    isEqual,
  );
}
