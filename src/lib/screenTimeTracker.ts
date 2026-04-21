import { Capacitor } from '@capacitor/core';

import { getKidSettings } from '@/hooks/useKuboFamily';
import { getScreenTimeToday, logScreenTime } from '@/lib/screenTimeStore';

/**
 * Module-level singleton that tracks in-app screen time for the active kid.
 *
 * Lifecycle: `start(kidPubkey)` when a kid enters /kid routes, `stop()` when
 * they leave. The interval ticks every second, bumping `usedSeconds`.
 * On background (Capacitor `appStateChange`) the timer pauses and flushes to
 * secureStorage. On foreground it resumes (unless locked).
 *
 * Follows the same useSyncExternalStore pattern as useKuboFamily.
 */

// ─── State ───────────────────────────────────────────────────────────────────

interface TrackerState {
  kidPubkey: string | null;
  usedSeconds: number;
  isLocked: boolean;
  isOutsideWindow: boolean;
  running: boolean;
}

const FLUSH_INTERVAL_S = 30;

let state: TrackerState = {
  kidPubkey: null,
  usedSeconds: 0,
  isLocked: false,
  isOutsideWindow: false,
  running: false,
};

let tickHandle: ReturnType<typeof setInterval> | null = null;
let secondsSinceFlush = 0;
let appStateListener: { remove: () => void } | null = null;

const subscribers = new Set<() => void>();

function notify(): void {
  subscribers.forEach((cb) => cb());
}

function setState(patch: Partial<TrackerState>): void {
  state = { ...state, ...patch };
  notify();
}

// ─── Time-window check ──────────────────────────────────────────────────────

function isInsideWindow(windowStart: string, windowEnd: string): boolean {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();

  const [sh, sm] = windowStart.split(':').map(Number);
  const [eh, em] = windowEnd.split(':').map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;

  // Handle overnight windows (e.g. 22:00 – 06:00).
  if (start <= end) {
    return mins >= start && mins < end;
  }
  return mins >= start || mins < end;
}

// ─── Lock evaluation ─────────────────────────────────────────────────────────

function evaluateLock(): void {
  const pubkey = state.kidPubkey;
  if (!pubkey) return;

  const settings = getKidSettings(pubkey);
  const limitSeconds = settings.dailyLimitMin * 60;
  const outsideWindow = !isInsideWindow(settings.windowStart, settings.windowEnd);
  const overLimit = state.usedSeconds >= limitSeconds;

  setState({
    isLocked: outsideWindow || overLimit,
    isOutsideWindow: outsideWindow,
  });
}

// ─── Flush to storage ────────────────────────────────────────────────────────

async function flush(): Promise<void> {
  if (!state.kidPubkey || state.usedSeconds === 0) return;
  await logScreenTime(state.kidPubkey, state.usedSeconds);
  secondsSinceFlush = 0;
}

// ─── Tick ────────────────────────────────────────────────────────────────────

function tick(): void {
  if (state.isLocked) return;

  setState({ usedSeconds: state.usedSeconds + 1 });
  secondsSinceFlush++;

  evaluateLock();

  if (secondsSinceFlush >= FLUSH_INTERVAL_S) {
    void flush();
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function start(kidPubkey: string): void {
  // Stop any previous session.
  if (state.running) {
    stopTracker();
  }

  const stored = getScreenTimeToday(kidPubkey);
  setState({
    kidPubkey,
    usedSeconds: stored,
    isLocked: false,
    isOutsideWindow: false,
    running: true,
  });

  evaluateLock();

  if (!state.isLocked) {
    tickHandle = setInterval(tick, 1000);
  }

  // Listen for foreground/background on native.
  if (Capacitor.isNativePlatform()) {
    void import('@capacitor/app').then(({ App }) => {
      App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          resume();
        } else {
          pause();
        }
      }).then((handle) => {
        appStateListener = handle;
      });
    });
  }
}

export function pause(): void {
  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
  void flush();
}

export function resume(): void {
  if (!state.running || !state.kidPubkey) return;

  // Re-read stored value in case another write happened.
  const stored = getScreenTimeToday(state.kidPubkey);
  if (stored > state.usedSeconds) {
    setState({ usedSeconds: stored });
  }

  evaluateLock();

  if (!state.isLocked && !tickHandle) {
    tickHandle = setInterval(tick, 1000);
  }
}

export function stopTracker(): void {
  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
  void flush();

  if (appStateListener) {
    appStateListener.remove();
    appStateListener = null;
  }

  setState({
    kidPubkey: null,
    usedSeconds: 0,
    isLocked: false,
    isOutsideWindow: false,
    running: false,
  });
}

// ─── React binding (useSyncExternalStore) ────────────────────────────────────

export function subscribe(onStoreChange: () => void): () => void {
  subscribers.add(onStoreChange);
  return () => {
    subscribers.delete(onStoreChange);
  };
}

export function getSnapshot(): TrackerState {
  return state;
}
