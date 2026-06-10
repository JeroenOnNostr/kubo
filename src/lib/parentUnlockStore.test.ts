import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  BASE_COOLDOWN_MS,
  LOCKOUT_THRESHOLD,
  UNLOCK_TTL_MS,
  cooldownRemainingMs,
  isInCooldown,
  isParentUnlocked,
  lockParent,
  pinFailureCount,
  recordPinFailure,
  recordPinSuccess,
  subscribeParentUnlock,
  unlockParent,
  unlockRemainingMs,
  __resetParentUnlockStoreForTests,
} from './parentUnlockStore';

/**
 * KUBO-153 — the in-memory parent-gate store. Two state machines:
 *  (1) the unlock flag with its three clear-triggers and 10-min TTL, and
 *  (2) the PIN lockout (5 fails → 60s, doubling). Both must be in-memory only
 *  and pure enough to unit-test without React.
 */
describe('parentUnlockStore (KUBO-153)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetParentUnlockStoreForTests();
  });
  afterEach(() => {
    __resetParentUnlockStoreForTests();
    vi.useRealTimers();
  });

  describe('unlock flag', () => {
    it('starts locked', () => {
      expect(isParentUnlocked()).toBe(false);
    });

    it('unlockParent sets the flag and unlockRemainingMs', () => {
      unlockParent();
      expect(isParentUnlocked()).toBe(true);
      expect(unlockRemainingMs()).toBeGreaterThan(0);
      expect(unlockRemainingMs()).toBeLessThanOrEqual(UNLOCK_TTL_MS);
    });

    it('clear-trigger: lockParent() clears the flag (navigation-out / background)', () => {
      unlockParent();
      expect(isParentUnlocked()).toBe(true);
      lockParent();
      expect(isParentUnlocked()).toBe(false);
      expect(unlockRemainingMs()).toBe(0);
    });

    it('clear-trigger: the 10-minute TTL timer expires the unlock', () => {
      unlockParent();
      expect(isParentUnlocked()).toBe(true);
      vi.advanceTimersByTime(UNLOCK_TTL_MS - 1);
      expect(isParentUnlocked()).toBe(true);
      vi.advanceTimersByTime(2);
      expect(isParentUnlocked()).toBe(false);
    });

    it('lazily expires even if the timer never fires (throttled background tab)', () => {
      unlockParent();
      // Simulate wall-clock passing without the timer callback running.
      vi.setSystemTime(Date.now() + UNLOCK_TTL_MS + 1000);
      expect(isParentUnlocked()).toBe(false);
    });

    it('notifies subscribers on unlock and lock', () => {
      const listener = vi.fn();
      const unsub = subscribeParentUnlock(listener);
      unlockParent();
      expect(listener).toHaveBeenCalledTimes(1);
      lockParent();
      expect(listener).toHaveBeenCalledTimes(2);
      unsub();
      unlockParent();
      expect(listener).toHaveBeenCalledTimes(2); // no more after unsubscribe
    });

    it('lockParent is idempotent (no emit when already locked)', () => {
      const listener = vi.fn();
      subscribeParentUnlock(listener);
      lockParent();
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('PIN lockout state machine', () => {
    it('does not cool down before the threshold', () => {
      for (let i = 0; i < LOCKOUT_THRESHOLD - 1; i++) {
        expect(recordPinFailure()).toBe(0);
      }
      expect(pinFailureCount()).toBe(LOCKOUT_THRESHOLD - 1);
      expect(isInCooldown()).toBe(false);
    });

    it('5 consecutive failures trigger a 60s cooldown', () => {
      let cooldown = 0;
      for (let i = 0; i < LOCKOUT_THRESHOLD; i++) {
        cooldown = recordPinFailure();
      }
      expect(cooldown).toBe(BASE_COOLDOWN_MS);
      expect(isInCooldown()).toBe(true);
      expect(cooldownRemainingMs()).toBeGreaterThan(0);
      expect(cooldownRemainingMs()).toBeLessThanOrEqual(BASE_COOLDOWN_MS);
      // The consecutive-fail counter resets after a lockout.
      expect(pinFailureCount()).toBe(0);
    });

    it('cooldown doubles each subsequent lockout (60s, 120s, 240s)', () => {
      const trigger = () => {
        let c = 0;
        for (let i = 0; i < LOCKOUT_THRESHOLD; i++) c = recordPinFailure();
        return c;
      };

      expect(trigger()).toBe(BASE_COOLDOWN_MS);
      // Let the first cooldown elapse so the next set of 5 can register.
      vi.advanceTimersByTime(BASE_COOLDOWN_MS);
      expect(isInCooldown()).toBe(false);

      expect(trigger()).toBe(BASE_COOLDOWN_MS * 2);
      vi.advanceTimersByTime(BASE_COOLDOWN_MS * 2);

      expect(trigger()).toBe(BASE_COOLDOWN_MS * 4);
    });

    it('cooldown elapses after its duration', () => {
      for (let i = 0; i < LOCKOUT_THRESHOLD; i++) recordPinFailure();
      expect(isInCooldown()).toBe(true);
      vi.advanceTimersByTime(BASE_COOLDOWN_MS - 1);
      expect(isInCooldown()).toBe(true);
      vi.advanceTimersByTime(2);
      expect(isInCooldown()).toBe(false);
      expect(cooldownRemainingMs()).toBe(0);
    });

    it('a success resets the failure counter and escalation', () => {
      // Almost trip the first lockout...
      for (let i = 0; i < LOCKOUT_THRESHOLD - 1; i++) recordPinFailure();
      expect(pinFailureCount()).toBe(LOCKOUT_THRESHOLD - 1);

      recordPinSuccess();
      expect(pinFailureCount()).toBe(0);
      expect(isInCooldown()).toBe(false);

      // After a success, it again takes a full THRESHOLD and the cooldown is
      // back to the BASE (escalation reset).
      let cooldown = 0;
      for (let i = 0; i < LOCKOUT_THRESHOLD; i++) cooldown = recordPinFailure();
      expect(cooldown).toBe(BASE_COOLDOWN_MS);
    });

    it('a success during an active cooldown clears it', () => {
      for (let i = 0; i < LOCKOUT_THRESHOLD; i++) recordPinFailure();
      expect(isInCooldown()).toBe(true);
      recordPinSuccess();
      expect(isInCooldown()).toBe(false);
      expect(cooldownRemainingMs()).toBe(0);
    });
  });
});
