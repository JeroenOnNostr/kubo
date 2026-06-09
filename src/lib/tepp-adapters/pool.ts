import type { Filter } from 'nostr-tools/filter';
import type { Event as NostrToolsEvent } from 'nostr-tools/core';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

/**
 * TEPP-compatible pool API backed by Kubo's Nostrify pool. The TEPP reference
 * implementation (`tepp/tepp-webapp/src/nostr/pool.ts`) uses
 * `nostr-tools` SimplePool with shape `query(relays, filter, maxWaitMs) →
 * Promise<Event[]>`. Kubo uses Nostrify's NPool with shape
 * `nostr.query(filters, opts) → Promise<NostrEvent[]>`. This module
 * translates one to the other.
 *
 * The `relays` argument is currently informational — Kubo's NPool already
 * routes through the parent's NIP-65 read relays plus user-configured
 * defaults. If TEPP requests a specific relay set we don't yet honor it
 * per-call; future work can plumb relay routing through `nostr.req()`.
 */
export interface TeppPool {
  query: (relays: string[], filter: Filter, maxWaitMs?: number) => Promise<NostrToolsEvent[]>;
}

export function makeTeppPool(nostr: {
  query: (filters: NostrFilter[], opts?: { signal?: AbortSignal }) => Promise<NostrEvent[]>;
}): TeppPool {
  return {
    query: async (_relays, filter, maxWaitMs = 4000) => {
      const events = await nostr.query([filter as NostrFilter], {
        signal: AbortSignal.timeout(maxWaitMs),
      });
      return events as NostrToolsEvent[];
    },
  };
}
