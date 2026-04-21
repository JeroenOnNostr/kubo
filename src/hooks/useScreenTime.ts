import { useSyncExternalStore } from 'react';

import { subscribe, getSnapshot } from '@/lib/screenTimeTracker';
import {
  subscribeScreenTime,
  getScreenTimeSnapshot,
  getScreenTimeLog,
} from '@/lib/screenTimeStore';
import { getKidSettings } from '@/hooks/useKuboFamily';
import { todayDateStr } from '@/lib/formatTime';
import type { KidSettings } from '@/hooks/useKuboFamily';
import type { ScreenTimeEntry } from '@/lib/screenTimeStore';

/**
 * Reactive hook that returns screen time state for the currently-tracked kid
 * (active in /kid routes) or for a specific kid pubkey (parent dashboard).
 *
 * When called without arguments, reads from the live tracker singleton.
 * When called with a pubkey, reads stored data (for the parent view).
 */
export function useScreenTime(pubkeyOverride?: string) {
  const tracker = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  // Subscribe to the screen time store so parent-side reads re-render on flush.
  useSyncExternalStore(subscribeScreenTime, getScreenTimeSnapshot, getScreenTimeSnapshot);

  const pubkey = pubkeyOverride ?? tracker.kidPubkey;
  const settings: KidSettings | null = pubkey ? getKidSettings(pubkey) : null;

  const usedSeconds = pubkeyOverride
    ? (getScreenTimeLog(pubkey!).find((e) => e.date === todayDateStr())?.usedSeconds ?? 0)
    : tracker.usedSeconds;

  const dailyLimitMin = settings?.dailyLimitMin ?? 45;
  const limitSeconds = dailyLimitMin * 60;
  const remainingSeconds = Math.max(0, limitSeconds - usedSeconds);
  const remainingMinutes = Math.ceil(remainingSeconds / 60);
  const percentUsed = limitSeconds > 0
    ? Math.min(100, Math.round((usedSeconds / limitSeconds) * 100))
    : 0;

  return {
    usedSeconds,
    remainingSeconds,
    remainingMinutes,
    dailyLimitMin,
    percentUsed,
    isLocked: pubkeyOverride ? false : tracker.isLocked,
    isOutsideWindow: pubkeyOverride ? false : tracker.isOutsideWindow,
    running: tracker.running,
    settings,
  };
}

/**
 * Returns the screen time log (last 14 days) for a specific kid.
 */
export function useScreenTimeLog(kidPubkey: string): ScreenTimeEntry[] {
  // Subscribe to the screen time store so we re-render when data changes.
  useSyncExternalStore(subscribeScreenTime, getScreenTimeSnapshot, getScreenTimeSnapshot);
  return getScreenTimeLog(kidPubkey);
}
