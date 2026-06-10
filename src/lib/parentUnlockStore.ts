/**
 * KUBO-153: In-memory parent-gate unlock store + PIN lockout state machine.
 *
 * Why in-memory (module-level), NOT localStorage/sessionStorage:
 * a kid with the device can edit web storage. The "are we past the PIN gate"
 * flag and the failure/cooldown counters MUST live somewhere a kid can't poke
 * at without devtools. A page reload clears it (re-prompts the PIN), and a kid
 * clearing storage just resets the cooldown — both acceptable per the plan's
 * threat model (young kids tapping around, not a devtools-capable attacker).
 *
 * Three responsibilities, all pure and unit-testable:
 *   1. parentUnlocked flag — set ONLY by a verified PIN, auto-expires after
 *      UNLOCK_TTL_MS, cleared explicitly on navigation-out / app background.
 *   2. PIN lockout — 5 consecutive failures → 60s cooldown, doubling each
 *      subsequent lockout (60s, 120s, 240s, …).
 *   3. subscribe() so React components re-render when either changes.
 */

/** How long an unlock lasts before the parent must re-enter the PIN. */
export const UNLOCK_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Consecutive wrong PINs before the first cooldown kicks in. */
export const LOCKOUT_THRESHOLD = 5;

/** First cooldown duration; each subsequent lockout doubles it. */
export const BASE_COOLDOWN_MS = 60 * 1000; // 60 seconds

interface UnlockState {
  /** True while the parent is past the gate. */
  unlocked: boolean;
  /** Epoch ms when the current unlock expires (0 if locked). */
  expiresAt: number;
  /** Consecutive failed verify attempts since the last success/cooldown. */
  failCount: number;
  /** How many full lockouts have happened (drives the doubling). */
  lockoutCount: number;
  /** Epoch ms until which verification is blocked (0 if not cooling down). */
  cooldownUntil: number;
}

const state: UnlockState = {
  unlocked: false,
  expiresAt: 0,
  failCount: 0,
  lockoutCount: 0,
  cooldownUntil: 0,
};

type Listener = () => void;
const listeners = new Set<Listener>();

let expiryTimer: ReturnType<typeof setTimeout> | null = null;

function emit(): void {
  for (const l of listeners) l();
}

function clearExpiryTimer(): void {
  if (expiryTimer !== null) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
}

/** Subscribe to any change in unlock/lockout state. Returns an unsubscribe fn. */
export function subscribeParentUnlock(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Is the parent currently unlocked? Lazily expires a stale unlock so callers
 * always see a fresh answer even if the timer hasn't fired yet (e.g. fake
 * timers in tests, or a backgrounded tab whose timers were throttled).
 */
export function isParentUnlocked(): boolean {
  if (state.unlocked && Date.now() >= state.expiresAt) {
    // Expired — fold it down without emitting twice if a listener triggers us.
    lockParent();
  }
  return state.unlocked;
}

/** Set the unlock flag (called ONLY after a verified PIN). Starts the TTL. */
export function unlockParent(): void {
  clearExpiryTimer();
  state.unlocked = true;
  state.expiresAt = Date.now() + UNLOCK_TTL_MS;
  // Auto-expire. In jsdom/Node setTimeout returns an object; .unref keeps the
  // process from being held open in tests. Guard for environments without it.
  expiryTimer = setTimeout(() => {
    lockParent();
  }, UNLOCK_TTL_MS);
  (expiryTimer as unknown as { unref?: () => void }).unref?.();
  emit();
}

/**
 * Clear the unlock flag. Called on the three lock triggers:
 * navigation out of /parent/*, app background (visibilitychange→hidden),
 * and the TTL timer. Idempotent.
 */
export function lockParent(): void {
  clearExpiryTimer();
  if (!state.unlocked && state.expiresAt === 0) {
    // Already locked — still emit nothing to avoid render churn.
    return;
  }
  state.unlocked = false;
  state.expiresAt = 0;
  emit();
}

/** Remaining unlock time in ms (0 if locked). For diagnostics/tests. */
export function unlockRemainingMs(): number {
  if (!isParentUnlocked()) return 0;
  return Math.max(0, state.expiresAt - Date.now());
}

// ── PIN lockout state machine ──────────────────────────────────────────────

/** Is verification currently blocked by a cooldown? */
export function isInCooldown(): boolean {
  return cooldownRemainingMs() > 0;
}

/** Remaining cooldown in ms (0 if not cooling down). */
export function cooldownRemainingMs(): number {
  if (state.cooldownUntil === 0) return 0;
  const remaining = state.cooldownUntil - Date.now();
  if (remaining <= 0) {
    // Cooldown elapsed — clear it so the next attempt is allowed.
    state.cooldownUntil = 0;
    return 0;
  }
  return remaining;
}

/**
 * Record a failed PIN attempt. Returns the cooldown (ms) the caller should now
 * enforce, or 0 if no cooldown was triggered by this failure. When the
 * threshold is hit, a cooldown of BASE_COOLDOWN_MS * 2^lockoutCount starts and
 * the consecutive-fail counter resets (so the NEXT 5 fails trigger the next,
 * longer lockout).
 */
export function recordPinFailure(): number {
  state.failCount += 1;
  if (state.failCount >= LOCKOUT_THRESHOLD) {
    const cooldown = BASE_COOLDOWN_MS * 2 ** state.lockoutCount;
    state.lockoutCount += 1;
    state.failCount = 0;
    state.cooldownUntil = Date.now() + cooldown;
    emit();
    return cooldown;
  }
  emit();
  return 0;
}

/**
 * Record a successful PIN verification: resets the failure counter, the
 * lockout escalation, and any active cooldown. (A correct PIN means the real
 * parent is here — no reason to keep punishing.)
 */
export function recordPinSuccess(): void {
  state.failCount = 0;
  state.lockoutCount = 0;
  state.cooldownUntil = 0;
  emit();
}

/** Current consecutive-failure count (for the UI / tests). */
export function pinFailureCount(): number {
  return state.failCount;
}

/**
 * Test-only: reset the entire store to its initial state. Not used in
 * production code paths.
 * @internal
 */
export function __resetParentUnlockStoreForTests(): void {
  clearExpiryTimer();
  state.unlocked = false;
  state.expiresAt = 0;
  state.failCount = 0;
  state.lockoutCount = 0;
  state.cooldownUntil = 0;
  listeners.clear();
}
