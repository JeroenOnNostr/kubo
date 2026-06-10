import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { secureStorage } from '@/lib/secureStorage';
import {
  cooldownRemainingMs,
  isInCooldown,
  recordPinFailure,
  recordPinSuccess,
  subscribeParentUnlock,
} from '@/lib/parentUnlockStore';

/**
 * Local-only parent-gate PIN.
 *
 * - Stored as `sha-256(salt || pin)` in secureStorage so the plaintext PIN
 *   never touches disk (useful on web where secureStorage falls back to
 *   localStorage).
 * - Deliberately *not* a Nostr event — this is the "trust the device" gate
 *   between the kid mode and the parent dashboard, not a multi-device
 *   authenticator. Multi-device / biometric auth lands with KUBO-011.
 * - KUBO-153: retry lockout. 5 consecutive wrong PINs → a 60s cooldown that
 *   doubles each subsequent lockout (60s, 120s, 240s, …). Counters live
 *   in-memory only (`parentUnlockStore`) — a kid clearing storage just resets
 *   the cooldown, which is acceptable for the Kubo threat model. `verifyPin`
 *   refuses (returns `false`) while a cooldown is active, and the remaining
 *   cooldown is surfaced via `cooldownMs` for a visible countdown in the UI.
 */
const SALT_KEY = 'kubo:parent-gate:salt';
const HASH_KEY = 'kubo:parent-gate:hash';

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

function randomSalt(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return bytesToHex(buf);
}

async function sha256Hex(s: string): Promise<string> {
  const data = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
}

export interface ParentGatePin {
  /** null while loading; true if a PIN is set, false if the user still needs to set one. */
  isSet: boolean | null;
  /** Write a new 6-digit PIN. Overwrites any existing one. */
  setPin: (pin: string) => Promise<void>;
  /**
   * Return true iff the supplied 6-digit PIN matches the stored hash.
   * Returns false (without touching the hash) while a lockout cooldown is
   * active. A correct PIN clears the failure counter; a wrong one advances it
   * and may start a cooldown (KUBO-153).
   */
  verifyPin: (pin: string) => Promise<boolean>;
  /** Wipe the stored PIN (used on account reset). */
  clearPin: () => Promise<void>;
  /** Remaining lockout cooldown in ms (0 when not cooling down). Reactive. */
  cooldownMs: number;
}

export function useParentGatePin(): ParentGatePin {
  const [isSet, setIsSet] = useState<boolean | null>(null);

  // Reactive cooldown so the dialog can render a live countdown. The store
  // emits on every failure/success/lockout; we also tick once a second while a
  // cooldown is active so the displayed seconds count down to zero.
  const cooldownMs = useSyncExternalStore(
    (onChange) => {
      const unsub = subscribeParentUnlock(onChange);
      const interval = setInterval(() => {
        if (isInCooldown()) onChange();
      }, 1000);
      return () => {
        unsub();
        clearInterval(interval);
      };
    },
    () => cooldownRemainingMs(),
    () => 0,
  );

  // Initial probe — is a PIN already stored?
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const hash = await secureStorage.getItem(HASH_KEY);
      if (!cancelled) setIsSet(hash !== null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setPin = useCallback(async (pin: string) => {
    if (!/^\d{6}$/.test(pin)) {
      throw new Error('PIN must be exactly 6 digits');
    }
    const salt = randomSalt();
    const hash = await sha256Hex(salt + pin);
    await secureStorage.setItem(SALT_KEY, salt);
    await secureStorage.setItem(HASH_KEY, hash);
    setIsSet(true);
  }, []);

  const verifyPin = useCallback(async (pin: string) => {
    // Refuse during a lockout cooldown — don't even read the hash.
    if (isInCooldown()) return false;
    if (!/^\d{6}$/.test(pin)) return false;
    const [salt, hash] = await Promise.all([
      secureStorage.getItem(SALT_KEY),
      secureStorage.getItem(HASH_KEY),
    ]);
    if (!salt || !hash) return false;
    const candidate = await sha256Hex(salt + pin);
    if (candidate === hash) {
      recordPinSuccess();
      return true;
    }
    recordPinFailure();
    return false;
  }, []);

  const clearPin = useCallback(async () => {
    await secureStorage.removeItem(SALT_KEY);
    await secureStorage.removeItem(HASH_KEY);
    setIsSet(false);
  }, []);

  return { isSet, setPin, verifyPin, clearPin, cooldownMs };
}
