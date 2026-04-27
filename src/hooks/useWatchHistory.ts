import { useSyncExternalStore } from 'react';

import {
  getWatchHistory,
  getWatchHistorySnapshot,
  subscribeWatchHistory,
  type WatchEntry,
} from '@/lib/watchHistoryStore';

/**
 * Reactive read of a single kid's watch history. Re-renders on every
 * `recordWatch` write so a dashboard mounted alongside the kid feed
 * updates live as the kid plays new videos.
 *
 * Pass `limit` to truncate to the most-recent N entries (the home strip
 * uses ~10; the full-history page omits limit to read all 100).
 */
export function useWatchHistory(kidPubkey: string | undefined, limit?: number): WatchEntry[] {
  useSyncExternalStore(subscribeWatchHistory, getWatchHistorySnapshot, getWatchHistorySnapshot);
  if (!kidPubkey) return [];
  const all = getWatchHistory(kidPubkey);
  return typeof limit === 'number' ? all.slice(0, limit) : all;
}
