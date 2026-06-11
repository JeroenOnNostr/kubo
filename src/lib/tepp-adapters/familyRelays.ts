import { useCallback, useSyncExternalStore } from 'react';

import { secureStorage } from '@/lib/secureStorage';
import {
  KIND_ASSOCIATION,
  KIND_STATE,
  KIND_BLACKLIST,
  KIND_GLOBAL_RESTRICTION,
  PERMISSION_KINDS,
} from '@/lib/tepp/kinds';

/**
 * KUBO-173 part (1) — route TEPP events to the private family relay set.
 *
 * TEPP events (the kid-signed association 17700, the parent-signed state 34700,
 * the permission lists 8710–8717, the blacklist 8720, and the global
 * restrictions 8721) describe a minor: the kid↔parent linkage, the kid's full
 * allow-list / block-list (the minor's social graph), and the allowed-time
 * windows (the minor's daily schedule). The default `eventRouter`
 * (`NostrProvider.tsx`) fans every published event out to the user's PUBLIC
 * write relays, so without kind-aware routing all of that leaks to anyone.
 *
 * This module owns:
 *   1. `TEPP_KINDS` — the set of kinds that must NOT go to public relays.
 *   2. The parent-controlled, device-local "family relay set" — the private
 *      relay(s) TEPP data is confined to. It lives in its OWN secureStorage key
 *      (`kubo:family-relays`), NOT in the synced kid-writable feedSettings and
 *      NOT in `useKuboFamily.ts` (owned by a concurrent task this batch). Being
 *      device-local + parent-only is exactly right for a privacy control: a kid
 *      can't widen it, and it never syncs to a public relay.
 *   3. `routesForEvent` — the PURE routing decision, exported for testability.
 *
 * Part (2) — encrypting the list CONTENTS so the relay operator itself can't
 * read them — is a wire-format change drafted as an upstream issue
 * (`docs/tepp-upstream-encryption-issue.md`); it is out of scope here.
 */

/** The kinds whose published events must be confined to the family relay set. */
export const TEPP_KINDS: ReadonlySet<number> = new Set<number>([
  KIND_ASSOCIATION,
  KIND_STATE,
  ...PERMISSION_KINDS,
  KIND_BLACKLIST,
  KIND_GLOBAL_RESTRICTION,
]);

/** True when `kind` is a TEPP protocol kind that must be privately routed. */
export function isTeppKind(kind: number): boolean {
  return TEPP_KINDS.has(kind);
}

/** Normalize a relay URL for dedup/compare (lowercase, single trailing slash). */
export function normalizeRelayUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  return trimmed.toLowerCase().replace(/\/+$/, '') + '/';
}

/**
 * Config surface `routesForEvent` needs. Mirrors the fields the eventRouter
 * already has on hand in `NostrProvider`:
 *  - `familyRelays`  : the configured private family relay set (normalized).
 *  - `defaultRelays` : the public write relays a non-TEPP event routes to today
 *                      (the existing eventRouter behavior, passed through
 *                      untouched). Also the fallback target when no family relay
 *                      is set (KUBO-180).
 */
export interface RoutingConfig {
  familyRelays: string[];
  defaultRelays: string[];
}

/** Outcome of the pure routing decision. */
export interface RouteDecision {
  /** Relay URLs the event should be published to. */
  relays: string[];
  /**
   * True only for a TEPP event with NO family relay configured: routing fell
   * back to the public write relays, so the parent must be warned that TEPP
   * data is on public relays. Always false for non-TEPP events and for TEPP
   * events with a family relay set.
   */
  privacyWarning: boolean;
  /** Whether the event was treated as TEPP (privately routed). */
  isTepp: boolean;
}

/**
 * PURE routing decision (KUBO-173). Given an event kind and the resolved relay
 * config, decide where the event publishes:
 *
 *  - Non-TEPP kind  → the existing public write-relay set, unchanged. No warning.
 *  - TEPP kind, family relay set configured → ONLY the family relay set. The
 *    public write relays receive nothing. No warning.
 *  - TEPP kind, NO family relay set → fall back to the FULL public write-relay
 *    fan-out (the pre-KUBO-173 behavior); flag `privacyWarning` so the UI can
 *    tell the parent the data is public.
 *
 * KUBO-180: the fallback was originally the single primary write relay ("at
 * least stay off the broad fan-out"), but writeRelays[0] is relay.kubo.watch —
 * a pyramid relay with restricted writes that rejects every non-member pubkey.
 * Routing a fresh family's TEPP events there alone made every publish fail
 * ("All promises were rejected"), so no association ever existed and the kid
 * feed stayed fail-closed forever. Privacy is already conceded on this branch;
 * the fan-out must maximize the chance the events land somewhere.
 *
 * Defensive: empty strings are dropped and the family set is deduped. A TEPP
 * event NEVER routes to BOTH the family set and the public defaults — that would
 * defeat the whole point.
 */
export function routesForEvent(
  event: { kind: number },
  config: RoutingConfig,
): RouteDecision {
  if (!isTeppKind(event.kind)) {
    return { relays: config.defaultRelays, privacyWarning: false, isTepp: false };
  }

  const family = dedupeNonEmpty(config.familyRelays);
  if (family.length > 0) {
    return { relays: family, privacyWarning: false, isTepp: true };
  }

  // No family relay configured — fall back to the public write relays, and warn.
  return { relays: dedupeNonEmpty(config.defaultRelays), privacyWarning: true, isTepp: true };
}

/**
 * PURE read-routing decision (KUBO-173, read side). A query "targets only TEPP
 * kinds" when every filter pins `kinds` to the TEPP set (the construct pipeline
 * always sets `kinds`); the by-id referenced-event fetch (`{ids:[…]}`, no
 * `kinds`) is NOT a TEPP-only query and stays on the general read path.
 *
 * - Not a TEPP-only query → `null` (caller uses its default routing).
 * - TEPP-only query, no family relay set → `null` (default read fan-out keeps
 *   construct assembly working before a private relay is configured).
 * - TEPP-only query, family relay set configured → the UNION of the family set
 *   and the existing read relays. Reading the family set is the point; keeping
 *   the read relays as a fallback source means a private-relay flap doesn't
 *   blank the construct (the privacy win is the WRITE confinement, since the
 *   events are public until part-2 content encryption lands).
 *
 * Returns the relay URLs to read from, or `null` to defer to default routing.
 */
export function teppReadRelays(
  filters: Array<{ kinds?: number[] }>,
  familyRelays: string[],
  readRelays: string[],
): string[] | null {
  const family = dedupeNonEmpty(familyRelays);
  if (family.length === 0) return null;
  const everyFilterIsTepp =
    filters.length > 0 &&
    filters.every((f) => !!f?.kinds?.length && f.kinds.every((k) => isTeppKind(k)));
  if (!everyFilterIsTepp) return null;
  return [...new Set<string>([...family, ...readRelays])];
}

function dedupeNonEmpty(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    if (!u || !u.trim()) continue;
    const key = normalizeRelayUrl(u);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out;
}

// ─── Family relay set store (device-local, parent-controlled) ────────────────
// Same useSyncExternalStore pattern as useKuboFamily, but in its own module and
// its own storage key so it doesn't touch the concurrently-owned family record.

const STORAGE_KEY = 'kubo:family-relays';

let relays: string[] = [];
let hasBootstrapped = false;
let bootstrapCompleted = false;
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
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          relays = parsed.filter((x): x is string => typeof x === 'string');
        }
      } catch {
        relays = [];
      }
    }
  } finally {
    bootstrapCompleted = true;
    notify();
  }
}

/** Read the persisted family relay set (post-bootstrap snapshot). */
export function getFamilyRelays(): string[] {
  return relays;
}

/** Replace the family relay set (parent-controlled). Empty array clears it. */
export async function setFamilyRelays(next: string[]): Promise<void> {
  const cleaned = dedupeNonEmpty(next);
  relays = cleaned;
  await secureStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
  notify();
}

function subscribe(onStoreChange: () => void): () => void {
  void bootstrap();
  subscribers.add(onStoreChange);
  return () => {
    subscribers.delete(onStoreChange);
  };
}

function getSnapshot(): string[] {
  return relays;
}

function getBootstrappedSnapshot(): boolean {
  return bootstrapCompleted;
}

/** Stable subscribe/snapshot bindings so non-React seams (eventRouter) can read the same store. */
export const subscribeFamilyRelays = subscribe;
export const getFamilyRelaysSnapshot = getSnapshot;

/** React hook: the current family relay set + a setter. */
export function useFamilyRelays(): {
  familyRelays: string[];
  isBootstrapped: boolean;
  setFamilyRelays: (next: string[]) => Promise<void>;
} {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const isBootstrapped = useSyncExternalStore(
    subscribe,
    getBootstrappedSnapshot,
    getBootstrappedSnapshot,
  );
  const set = useCallback(setFamilyRelays, []);
  return { familyRelays: current, isBootstrapped, setFamilyRelays: set };
}

/**
 * Test-only reset of the module-level store. Not exported in production paths;
 * used by unit tests to isolate the singleton between cases.
 * @internal
 */
export function __resetFamilyRelaysStoreForTest(): void {
  relays = [];
  hasBootstrapped = false;
  bootstrapCompleted = false;
  subscribers.clear();
}
