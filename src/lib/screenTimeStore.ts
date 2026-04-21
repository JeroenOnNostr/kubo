import { secureStorage } from '@/lib/secureStorage';
import { todayDateStr } from '@/lib/formatTime';

/**
 * Standalone screen time persistence — isolated from the family record.
 *
 * Uses its own secureStorage key (`kubo:screentime`) so that the frequent
 * 30-second flushes from the tracker only touch a small JSON blob instead
 * of rewriting the entire KuboFamily record every time.
 *
 * Shape: { [kidPubkey]: ScreenTimeEntry[] }  (last 14 days per kid)
 */

export interface ScreenTimeEntry {
  date: string;        // "YYYY-MM-DD"
  usedSeconds: number; // cumulative for the day
}

type ScreenTimeData = { [kidPubkey: string]: ScreenTimeEntry[] };

const STORAGE_KEY = 'kubo:screentime';
const MAX_LOG_DAYS = 14;

// ─── In-memory cache ─────────────────────────────────────────────────────────

let data: ScreenTimeData = {};
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
      data = JSON.parse(raw) as ScreenTimeData;
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

export async function logScreenTime(
  kidPubkey: string,
  usedSeconds: number,
): Promise<void> {
  const kidLog = [...(data[kidPubkey] ?? [])];
  const today = todayDateStr();

  const idx = kidLog.findIndex((e) => e.date === today);
  if (idx >= 0) {
    kidLog[idx] = { date: today, usedSeconds };
  } else {
    kidLog.push({ date: today, usedSeconds });
  }

  // Prune entries older than 14 days.
  while (kidLog.length > MAX_LOG_DAYS) {
    kidLog.shift();
  }

  data = { ...data, [kidPubkey]: kidLog };
  await persist();
  notify();
}

export function getScreenTimeToday(kidPubkey: string): number {
  const today = todayDateStr();
  const entry = data[kidPubkey]?.find((e) => e.date === today);
  return entry?.usedSeconds ?? 0;
}

export function getScreenTimeLog(kidPubkey: string): ScreenTimeEntry[] {
  return data[kidPubkey] ?? [];
}

// ─── React binding (useSyncExternalStore) ────────────────────────────────────

export function subscribeScreenTime(onStoreChange: () => void): () => void {
  void bootstrap();
  subscribers.add(onStoreChange);
  return () => {
    subscribers.delete(onStoreChange);
  };
}

export function getScreenTimeSnapshot(): ScreenTimeData {
  return data;
}
