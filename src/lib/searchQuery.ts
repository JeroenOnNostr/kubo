import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import type {
  NostrRelayEVENT,
  NostrRelayEOSE,
  NostrRelayCLOSED,
} from '@nostrify/types';

/**
 * Minimal shape we need from the pool/batcher — just `req` with a per-call
 * `eoseTimeout`. The app's `nostr` (an NPool wrapped by NostrBatcher) satisfies
 * this; the helper takes it as a param so it stays framework-agnostic and
 * unit-testable without React.
 */
interface ReqCapable {
  req(
    filters: NostrFilter[],
    opts?: { signal?: AbortSignal; eoseTimeout?: number },
  ): AsyncIterable<NostrRelayEVENT | NostrRelayEOSE | NostrRelayCLOSED>;
}

export interface SearchQueryOpts {
  /** Outer abort (e.g. TanStack's queryFn signal). */
  signal?: AbortSignal;
  /**
   * Grace for the slower search relay after the FIRST relay EOSEs, before
   * NPool.req aborts the laggards. Must be long enough for the second Ditto
   * search relay to answer. Default 2500ms.
   */
  eoseTimeout?: number;
  /**
   * Hard ceiling on the whole call regardless of relay behaviour. Returns
   * whatever arrived so far (never throws) when it fires. Default 6000ms.
   */
  timeout?: number;
}

/**
 * NIP-50 search that waits long enough for ALL search relays to answer, instead
 * of `NPool.query()`'s global 300ms `eoseTimeout` which truncates the slower
 * Ditto relay — that race made the search dropdown flicker, with completed-token
 * matches disappearing non-deterministically (KUBO-194).
 *
 * Drives `nostr.req` directly because `query()` hardcodes `this.opts.eoseTimeout`
 * and ignores per-call overrides, whereas `req` honours `opts.eoseTimeout`.
 *
 * - Breaks on EOSE — NPool.req only yields EOSE once EVERY routed relay EOSEs,
 *   so we genuinely wait for both search relays.
 * - Dedupes replaceable events (kind 0/3, 10000-19999, addressable 30000-39999)
 *   keeping the latest created_at; regular events deduped by id.
 * - Returns partial results on timeout/abort; never throws (matches query()'s
 *   contract so TanStack useQuery doesn't flip to an error state).
 * - NEVER pass `limit: 0` — `req` has no `limit:0` short-circuit (query does),
 *   so it would open a real, never-resolving subscription.
 */
export async function searchQuery(
  nostr: ReqCapable,
  filters: NostrFilter[],
  opts: SearchQueryOpts = {},
): Promise<NostrEvent[]> {
  const { signal, eoseTimeout = 2500, timeout = 6000 } = opts;

  // Compose the outer signal with a hard ceiling so the helper self-terminates
  // even if a relay never EOSEs and never sends another message (the case the
  // pool's synchronous-check abort can't catch).
  const ceiling = AbortSignal.timeout(timeout);
  const composed = signal ? AbortSignal.any([signal, ceiling]) : ceiling;

  // Keyed dedupe: replaceable -> kind:pubkey(:d), regular -> id. Keep latest.
  const byKey = new Map<string, NostrEvent>();
  const keyFor = (e: NostrEvent): string => {
    if (e.kind === 0 || e.kind === 3 || (e.kind >= 10000 && e.kind < 20000)) {
      return `${e.kind}:${e.pubkey}`;
    }
    if (e.kind >= 30000 && e.kind < 40000) {
      const d = e.tags.find((t) => t[0] === 'd')?.[1] ?? '';
      return `${e.kind}:${e.pubkey}:${d}`;
    }
    return e.id;
  };

  try {
    for await (const msg of nostr.req(filters, { signal: composed, eoseTimeout })) {
      if (msg[0] === 'EVENT') {
        const ev = msg[2];
        const key = keyFor(ev);
        const existing = byKey.get(key);
        if (!existing || ev.created_at > existing.created_at) {
          byKey.set(key, ev);
        }
      } else if (msg[0] === 'EOSE' || msg[0] === 'CLOSED') {
        // All routed relays have EOSEd (NPool only yields EOSE then), or a
        // relay CLOSED the subscription — either way we're done.
        break;
      }
    }
  } catch {
    // Aborted / relay error — fall through and return partial results.
  }

  return [...byKey.values()];
}
