import { secureStorage } from '@/lib/secureStorage';

/**
 * Standalone watch history persistence — isolated from the family record.
 *
 * Snapshots video plays at write time so the parent dashboard can render
 * thumbnails/titles with zero network hops, even if the underlying event
 * later disappears from relays. Mirrors `screenTimeStore` so a single
 * pattern covers both per-kid local timelines.
 *
 * Shape: { [kidPubkey]: WatchEntry[] }  (newest first, dedupe by eventId,
 * capped at MAX_ENTRIES_PER_KID).
 */

export interface WatchEntry {
  eventId: string;        // hex — used as the dedupe/key, even for addressable events
  kind: 21 | 22 | 34236;
  authorPubkey: string;   // hex
  authorName: string;     // snapshot at write time, may be empty
  title: string;          // snapshot, may be empty
  thumbnailUrl?: string;
  durationSec?: number;
  viewedAt: number;       // unix seconds, client clock
  // Set for addressable kinds (34236). Click-through prefers this over eventId
  // because /parent/video/:id needs an naddr1 to resolve a parameterized event.
  naddr?: string;
}

type WatchHistoryData = { [kidPubkey: string]: WatchEntry[] };

const STORAGE_KEY = 'kubo:watchhistory';
const MAX_ENTRIES_PER_KID = 100;
/**
 * Drop a rewatch of the same eventId if it lands within this window.
 * Without this debounce, navigating to a video's detail page and back
 * remounts the player and logs the same eventId twice within seconds —
 * which then bumps the activity-chart aggregate by double the real
 * watch time. 30s is long enough to absorb mount churn without
 * suppressing genuine "I went to lunch and watched it again."
 */
const REWATCH_DEBOUNCE_SEC = 30;

// ─── In-memory cache ─────────────────────────────────────────────────────────

let data: WatchHistoryData = {};
let hasBootstrapped = false;
const subscribers = new Set<() => void>();

function notify(): void {
  subscribers.forEach((cb) => cb());
}

async function bootstrap(): Promise<void> {
  if (hasBootstrapped) return;
  hasBootstrapped = true;
  try {
    const raw = await secureStorage.getItem(STORAGE_KEY);
    if (raw) {
      data = JSON.parse(raw) as WatchHistoryData;
    }
  } catch {
    data = {};
  } finally {
    notify();
  }
}

async function persist(): Promise<void> {
  await secureStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function recordWatch(
  kidPubkey: string,
  entry: WatchEntry,
): Promise<void> {
  const existing = data[kidPubkey] ?? [];

  // Suppress mount-churn rewatches: same eventId within REWATCH_DEBOUNCE_SEC
  // is a no-op. Real rewatches (after the window) still move the entry to
  // the front and refresh its snapshot.
  const prior = existing.find((e) => e.eventId === entry.eventId);
  if (prior && entry.viewedAt - prior.viewedAt < REWATCH_DEBOUNCE_SEC) {
    return;
  }

  // Dedupe by eventId: drop the previous occurrence so the new one moves to
  // the front. Re-views update viewedAt (and any snapshot fields if the
  // event has been edited upstream).
  const filtered = existing.filter((e) => e.eventId !== entry.eventId);
  const next = [entry, ...filtered].slice(0, MAX_ENTRIES_PER_KID);

  data = { ...data, [kidPubkey]: next };
  await persist();
  notify();
}

export function getWatchHistory(kidPubkey: string): WatchEntry[] {
  return data[kidPubkey] ?? [];
}

// ─── React binding (useSyncExternalStore) ────────────────────────────────────

export function subscribeWatchHistory(onStoreChange: () => void): () => void {
  void bootstrap();
  subscribers.add(onStoreChange);
  return () => {
    subscribers.delete(onStoreChange);
  };
}

export function getWatchHistorySnapshot(): WatchHistoryData {
  return data;
}
