import React, { useEffect, useMemo, useRef } from 'react';
import { NostrEvent, NostrFilter, NPool, NRelay1 } from '@nostrify/nostrify';
import { NostrContext } from '@nostrify/react';
import { NUser, useNostrLogin } from '@nostrify/react/login';
import type { NostrSigner } from '@nostrify/types';
import { useAppContext } from '@/hooks/useAppContext';
import { useKuboFamily } from '@/hooks/useKuboFamily';
import { getEffectiveRelays, DITTO_RELAYS, DIVINE_RELAY, ZAPSTORE_RELAY, NIP29_RELAYS, WARMUP_RELAYS } from '@/lib/appRelays';
import { NostrBatcher } from '@/lib/NostrBatcher';
import {
  isTeppKind,
  routesForEvent,
  teppReadRelays,
  getFamilyRelaysSnapshot,
  subscribeFamilyRelays,
} from '@/lib/tepp-adapters/familyRelays';

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
  const { family } = useKuboFamily();

  // Create NPool instance only once
  const pool = useRef<NPool | undefined>(undefined);

  // Use refs so the pool always has the latest data
  const effectiveRelays = useRef(getEffectiveRelays(config.relayMetadata, config.useAppRelays));

  // KUBO-173: the private family relay set TEPP events are confined to. Read
  // from a ref (kept in sync with the device-local store below) so the
  // long-lived reqRouter/eventRouter closures always see the latest set without
  // recreating the pool.
  const familyRelaysRef = useRef<string[]>(getFamilyRelaysSnapshot());

  // Stable refs to signers used for NIP-42 AUTH. The `open()` callback
  // reads from these when a relay sends an AUTH challenge, so they
  // always use the latest signer without recreating the pool.
  const signerRef = useRef<NostrSigner | undefined>(undefined);
  // Parent-pinned signer for NIP-29 relays — kid accounts are not
  // members of the parent's private groups, so the relay would
  // silently EOSE 39001/39002 on a kid-AUTH'd connection. Falls back
  // to the active signer when no family is configured (solo install)
  // or the parent isn't currently among `logins`.
  const parentSignerRef = useRef<NostrSigner | undefined>(undefined);

  // Helper to materialise an NUser signer from any stored login type.
  // Pulled out so we can resolve both the active login and the parent
  // login the same way.
  const signerFromLogin = (login: typeof logins[number] | undefined): NostrSigner | undefined => {
    if (!login) return undefined;
    try {
      switch (login.type) {
        case 'nsec':
          return NUser.fromNsecLogin(login).signer;
        case 'bunker':
          // pool.current is guaranteed to exist here: the pool is created
          // synchronously during the first render (below), and useMemo runs
          // after the render body has executed.
          return NUser.fromBunkerLogin(login, pool.current!).signer;
        case 'extension':
          return NUser.fromExtensionLogin(login).signer;
        default:
          return undefined;
      }
    } catch {
      return undefined;
    }
  };

  // Derive the current signer from the active login. This mirrors the
  // logic in useCurrentUser but avoids a circular dependency (useCurrentUser
  // depends on NostrContext which we are providing here).
  const currentLogin = logins[0];
  const currentSigner = useMemo(
    () => signerFromLogin(currentLogin),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentLogin],
  );

  // Derive the parent signer (when a family is configured + the parent
  // login is present in `logins`). Mirrors the resolution rules in
  // useParentSigner — solo installs (no family) fall back to the
  // active login; a family with the parent logged out returns undefined
  // so AUTH fails explicitly rather than silently signing as a kid.
  const parentSigner = useMemo(() => {
    if (!family) return currentSigner;
    for (const login of logins) {
      try {
        let pk: string | undefined;
        switch (login.type) {
          case 'nsec':
            pk = NUser.fromNsecLogin(login).pubkey;
            break;
          case 'extension':
            pk = NUser.fromExtensionLogin(login).pubkey;
            break;
          case 'bunker':
            pk = NUser.fromBunkerLogin(login, pool.current!).pubkey;
            break;
        }
        if (pk === family.parentPubkey) return signerFromLogin(login);
      } catch {
        // ignore — try the next login
      }
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logins, family, currentSigner]);

  // Keep the refs in sync so the AUTH callback always sees the latest signer.
  signerRef.current = currentSigner;
  parentSignerRef.current = parentSigner;

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

  // KUBO-173: keep the family-relay ref in sync with the device-local store.
  // Subscribe imperatively (the routers read the ref, not React state) so a
  // parent changing the family relay in settings is reflected on the next query
  // without recreating the pool. Prime once on mount in case bootstrap resolved
  // before the subscription attached.
  useEffect(() => {
    familyRelaysRef.current = getFamilyRelaysSnapshot();
    return subscribeFamilyRelays(() => {
      familyRelaysRef.current = getFamilyRelaysSnapshot();
    });
  }, []);

  // Initialize NPool only once
  if (!pool.current) {
    pool.current = new NPool({
      open(url: string) {
        // NIP-29 relays gate the moderation/relay-state kinds (39001,
        // 39002, kind-9 chat in private groups, kind-9000/9001 etc.)
        // behind NIP-42 AUTH for non-public groups, returning EOSE with
        // no events when the AUTH'd identity isn't a member. In Kubo's
        // parental model a kid is rarely a member of the parent's
        // groups, so AUTH'ing as the active kid silently empties the
        // members tab. Pin AUTH on these specific relays to the parent
        // identity instead. For everything else, keep using the active
        // signer (NIP-65 sync, write-relay AUTH challenges, etc.).
        const isNip29Relay = (NIP29_RELAYS as readonly string[]).includes(url);
        return new NRelay1(url, {
          // NIP-42: Respond to relay AUTH challenges by signing a kind
          // 22242 ephemeral event with the relevant signer.
          auth: async (challenge: string) => {
            const signer = isNip29Relay
              ? (parentSignerRef.current ?? signerRef.current)
              : signerRef.current;
            if (!signer) {
              throw new Error(
                isNip29Relay
                  ? 'AUTH failed: parent must be logged in to read this group on this device.'
                  : 'AUTH failed: no signer available (user not logged in)',
              );
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

        // KUBO-173 (read side): TEPP construct queries (association/state/
        // permission/blacklist/global) read from the private family relay set —
        // that's where the eventRouter confines them on the write side, so the
        // construct can only assemble against relays that hold those events. The
        // pure `teppReadRelays` decides: TEPP-only query + a configured family
        // set → read the family set ∪ the read relays; otherwise → null (defer to
        // the default read fan-out below, so construct assembly keeps working
        // before a private relay is configured, and the by-id referenced-event
        // fetch `{ids:[…]}` stays on the general path).
        const teppRelays = teppReadRelays(filters, familyRelaysRef.current, readRelays);
        if (teppRelays) {
          const teppRoutes = new Map<string, NostrFilter[]>();
          for (const url of teppRelays) teppRoutes.set(url, filters);
          return teppRoutes;
        }

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

        // KUBO-173: kind-aware routing. TEPP events (kid↔parent association,
        // permission/blacklist/global lists, allowed-time windows) describe a
        // minor's social graph + daily schedule. `routesForEvent` confines them
        // to the configured family relay set; with none configured it falls
        // back to the full public write fan-out (KUBO-180 — a single-relay
        // fallback broke every fresh family because writeRelays[0] is a
        // restricted-writes pyramid relay; privacyWarning is surfaced to the
        // parent in settings). Non-TEPP events keep the existing public
        // write-relay routing exactly.
        if (isTeppKind(event.kind)) {
          const decision = routesForEvent(event, {
            familyRelays: familyRelaysRef.current,
            defaultRelays: writeRelays,
          });
          return [...new Set(decision.relays)];
        }

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

  // Eagerly open the fastest app relays on boot so the first feed/follow-list
  // query doesn't pay the WebSocket+TLS+NIP-42 AUTH handshake inline (the
  // dominant cost on the Android APK over a mobile network). Routed per-relay
  // via nostr.relay(url) so it bypasses reqRouter and opens exactly these
  // sockets. `limit: 0` is the minimal subscription that creates the socket
  // and keeps it alive past NRelay1's ~30s idle-close until the real query
  // arrives and reuses it. Best-effort — failures are swallowed and the lazy
  // path still works if warm-up misses. Runs once, in parallel with React
  // mount / family bootstrap / cache hydration. (KUBO-142)
  useEffect(() => {
    const nostr = batcher.current ?? pool.current;
    if (!nostr) return;
    const signal = AbortSignal.timeout(4000);
    for (const url of WARMUP_RELAYS) {
      nostr.relay(url).query([{ kinds: [1], limit: 0 }], { signal }).catch(() => {});
    }
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
