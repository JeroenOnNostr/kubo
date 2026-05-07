import React, { useEffect, useMemo, useRef } from 'react';
import { NostrEvent, NostrFilter, NPool, NRelay1 } from '@nostrify/nostrify';
import { NostrContext } from '@nostrify/react';
import { NUser, useNostrLogin } from '@nostrify/react/login';
import type { NostrSigner } from '@nostrify/types';
import { useAppContext } from '@/hooks/useAppContext';
import { getEffectiveRelays, DITTO_RELAYS, DIVINE_RELAY, ZAPSTORE_RELAY, NIP29_RELAYS } from '@/lib/appRelays';
import { NostrBatcher } from '@/lib/NostrBatcher';

/** NIP-29 kinds emitted by users (chat + join/leave). */
const NIP29_USER_KINDS = new Set([9, 11, 9021, 9022]);
/** NIP-29 kinds emitted by admins (moderation). */
const NIP29_ADMIN_KINDS = new Set([9000, 9001, 9002, 9005, 9007]);
/** NIP-29 kinds the relay generates (group state). */
const NIP29_RELAY_KINDS = new Set([39000, 39001, 39002, 39003]);
/** Union of all NIP-29 kinds — used for the reqRouter fallback. */
const NIP29_KIND_SET = new Set<number>([
  ...NIP29_USER_KINDS,
  ...NIP29_ADMIN_KINDS,
  ...NIP29_RELAY_KINDS,
]);

interface NostrProviderProps {
  children: React.ReactNode;
}

const NostrProvider: React.FC<NostrProviderProps> = (props) => {
  const { children } = props;
  const { config } = useAppContext();
  const { logins } = useNostrLogin();

  // Create NPool instance only once
  const pool = useRef<NPool | undefined>(undefined);

  // Use refs so the pool always has the latest data
  const effectiveRelays = useRef(getEffectiveRelays(config.relayMetadata, config.useAppRelays));

  // Stable ref to the current user's signer for NIP-42 AUTH.
  // The `open()` callback reads from this ref when a relay sends an AUTH
  // challenge, so it always uses the latest signer without recreating the pool.
  const signerRef = useRef<NostrSigner | undefined>(undefined);

  // Derive the current signer from the active login. This mirrors the
  // logic in useCurrentUser but avoids a circular dependency (useCurrentUser
  // depends on NostrContext which we are providing here).
  const currentLogin = logins[0];
  const currentSigner = useMemo(() => {
    if (!currentLogin) return undefined;
    try {
      switch (currentLogin.type) {
        case 'nsec':
          return NUser.fromNsecLogin(currentLogin).signer;
        case 'bunker':
          // pool.current is guaranteed to exist here: the pool is created
          // synchronously during the first render (below), and useMemo runs
          // after the render body has executed.
          return NUser.fromBunkerLogin(currentLogin, pool.current!).signer;
        case 'extension':
          return NUser.fromExtensionLogin(currentLogin).signer;
        default:
          return undefined;
      }
    } catch {
      return undefined;
    }
  }, [currentLogin]);

  // Keep the ref in sync so the AUTH callback always sees the latest signer.
  signerRef.current = currentSigner;

  // Update effective relays ref when config changes. The NPool reads from
  // this ref, so new queries automatically use the updated relay set.
  //
  // We intentionally do NOT invalidate existing queries here. When relays
  // are added (e.g. NIP-65 sync merging user relays with app defaults),
  // existing cached data is still valid — we'll just query more relays on
  // the next natural refetch. Blanket invalidation caused a disruptive
  // full-feed rerender ~3s after page load when NostrSync synced relays.
  useEffect(() => {
    effectiveRelays.current = getEffectiveRelays(config.relayMetadata, config.useAppRelays);
  }, [config.relayMetadata, config.useAppRelays]);

  // Initialize NPool only once
  if (!pool.current) {
    pool.current = new NPool({
      open(url: string) {
        return new NRelay1(url, {
          // NIP-42: Respond to relay AUTH challenges by signing a kind
          // 22242 ephemeral event with the current user's signer.
          auth: async (challenge: string) => {
            const signer = signerRef.current;
            if (!signer) {
              throw new Error('AUTH failed: no signer available (user not logged in)');
            }
            return signer.signEvent({
              kind: 22242,
              content: '',
              tags: [
                ['relay', url],
                ['challenge', challenge],
              ],
              created_at: Math.floor(Date.now() / 1000),
            });
          },
        });
      },
      reqRouter(filters: NostrFilter[]): Map<URL['href'], NostrFilter[]> {
        const routes = new Map<string, NostrFilter[]>();

        // Search queries must go to search relays
        if (filters.some((f) => "search" in f)) {
          return new Map(DITTO_RELAYS.map(url => [url, filters]));
        }

        // Include divine relay for kind 34236 queries, which are addressable short videos
        if (filters.every((f) => f?.kinds?.length === 1 && f?.kinds[0] === 34236)) {
          return new Map([...DITTO_RELAYS, DIVINE_RELAY].map(url => [url, filters]));
        }

        // NIP-29 fallback: if every filter targets only NIP-29 kinds, fan out
        // to the configured NIP-29 relays. Group-aware hooks should always
        // route via `nostr.relay(url).query(...)` to the specific group's
        // host instead of relying on this branch — it's defensive only.
        if (filters.every((f) => f?.kinds?.length && f.kinds.every((k) => NIP29_KIND_SET.has(k)))) {
          return new Map(NIP29_RELAYS.map(url => [url, filters]));
        }

        // Route to all read relays
        const readRelays = effectiveRelays.current.relays
          .filter(r => r.read)
          .map(r => r.url);

        // Include zapstore relay for kind 32267 (apps), 30063 (releases), and 3063 (assets)
        const ZAPSTORE_KINDS = [32267, 30063, 3063];
        if (filters.every((f) => f?.kinds?.every((k) => ZAPSTORE_KINDS.includes(k)))) {
          return new Map([ZAPSTORE_RELAY, ...readRelays].map(url => [url, filters]));
        }

        for (const url of readRelays) {
          routes.set(url, filters);
        }

        return routes;
      },
      eventRouter(event: NostrEvent) {
        // NIP-29 user/admin events with an `h` tag must reach exactly one
        // relay (the group's host). Group-aware hooks handle that via
        // `nostr.relay(url).event(...)`. Returning [] here prevents the
        // pool from also fanning the event out to the user's default
        // write relays.
        if (
          (NIP29_USER_KINDS.has(event.kind) || NIP29_ADMIN_KINDS.has(event.kind)) &&
          event.tags.some(([t]) => t === 'h')
        ) {
          return [];
        }

        // Get write relays from effective relays
        const writeRelays = effectiveRelays.current.relays
          .filter(r => r.write)
          .map(r => r.url);

        const allRelays = new Set<string>(writeRelays);

        return [...allRelays];
      },
      // Resolve queries quickly once any relay sends EOSE, instead of
      // waiting for every relay to finish.
      eoseTimeout: 300,
    });
  }

  // Wrap the pool in a batching proxy. The proxy intercepts `.query()`
  // calls to automatically combine batchable filter patterns (profiles,
  // events by ID, reactions, d-tag lookups) into single REQs.
  // All other methods pass through directly to the underlying pool.
  const batcher = useRef<NostrBatcher | undefined>(undefined);
  if (!batcher.current && pool.current) {
    batcher.current = new NostrBatcher(pool.current);
  }

  // Cleanup: Close all relay connections when the provider unmounts
  useEffect(() => {
    return () => {
      if (pool.current) {
        pool.current.close();
      }
    };
  }, []);

  // Provide the batcher as the `nostr` object. It has the same interface
  // as NPool, so hooks using `useNostr()` get transparent batching.
  // The `as unknown as NPool` cast is safe because NostrBatcher exposes
  // all the same methods hooks use: query, event, req, relay, group, close.
  return (
    <NostrContext.Provider value={{ nostr: (batcher.current ?? pool.current) as unknown as NPool }}>
      {children}
    </NostrContext.Provider>
  );
};

export default NostrProvider;
