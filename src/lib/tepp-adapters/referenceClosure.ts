import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { extractReferences, referencedEventIds } from '@/lib/tepp/references';

/**
 * Resolve the transitive event-reference closure for a batch of feed events.
 *
 * The vendored evaluator (`src/lib/tepp/evaluate.ts`) is a *pure* function: it
 * reads referenced events from a caller-supplied `eventCache` and returns a
 * `pending` verdict for any reference it can't find. Its own doc comment says
 * "Caller should pre-fetch via prefetchReferenceClosure" — this module is that
 * pre-fetcher (it was named in the contract but never implemented, which is why
 * any reply/quote/repost evaluated to `pending` and got dropped from the kid
 * feed).
 *
 * We walk references breadth-first up to `maxDepth` hops (matching the
 * evaluator's recursion limit, default 4) so that nested references resolve to
 * a concrete admit/deny rather than `pending`. The returned map is the
 * `eventCache` to hand straight to `evaluateEvent`.
 */

/** Default closure depth — mirrors the evaluator's `maxDepth`. */
export const DEFAULT_CLOSURE_DEPTH = 4;

export interface PrefetchClosureResult {
  /** event id -> event, for every reference we managed to fetch (plus the seeds). */
  cache: Map<string, NostrEvent>;
  /** ids we tried to fetch but the relays didn't return (genuinely missing / not yet propagated). */
  missing: Set<string>;
}

/**
 * Collect the distinct event ids referenced by `events` that are not already
 * present in `have`. Addressable (`a`-tag) references are intentionally
 * excluded — the evaluator only recurses into plain event ids
 * (`referencedEventIds` already drops addressables).
 */
export function pendingReferenceIds(
  events: Iterable<NostrEvent>,
  have: ReadonlyMap<string, NostrEvent>,
): Set<string> {
  const out = new Set<string>();
  for (const ev of events) {
    const ids = referencedEventIds(
      extractReferences(ev as unknown as Parameters<typeof extractReferences>[0]),
    );
    for (const id of ids) {
      if (!have.has(id)) out.add(id);
    }
  }
  return out;
}

interface QueryFn {
  (filters: NostrFilter[], opts?: { signal?: AbortSignal }): Promise<NostrEvent[]>;
}

/**
 * Breadth-first fetch of the reference closure for `seeds`, into (or extending)
 * `seed`-keyed `cache`. Each hop batches all newly-discovered ids into a single
 * `{ ids: [...] }` filter. Stops at `maxDepth` hops or when no new ids surface.
 *
 * Pure I/O — no React. Safe to call from a query function. The same `cache`
 * map can be passed back in on a later batch to reuse already-fetched events.
 */
export async function prefetchReferenceClosure(
  seeds: NostrEvent[],
  query: QueryFn,
  opts: {
    maxDepth?: number;
    signal?: AbortSignal;
    timeoutMs?: number;
    /** Reuse/extend an existing cache instead of allocating a fresh one. */
    cache?: Map<string, NostrEvent>;
  } = {},
): Promise<PrefetchClosureResult> {
  const maxDepth = opts.maxDepth ?? DEFAULT_CLOSURE_DEPTH;
  const timeoutMs = opts.timeoutMs ?? 4000;
  const cache = opts.cache ?? new Map<string, NostrEvent>();
  const missing = new Set<string>();

  // Seeds themselves are addressable by id during recursion (a reply can
  // reference another seed in the same batch).
  for (const s of seeds) cache.set(s.id, s);

  // Frontier = events whose references we still need to expand.
  let frontier: NostrEvent[] = seeds;

  for (let depth = 0; depth < maxDepth; depth++) {
    const want = pendingReferenceIds(frontier, cache);
    // Drop ids we already know to be missing so we don't re-query them.
    for (const id of missing) want.delete(id);
    if (want.size === 0) break;

    const wantList = [...want];
    const signals = [AbortSignal.timeout(timeoutMs)];
    if (opts.signal) signals.push(opts.signal);
    let fetched: NostrEvent[] = [];
    try {
      fetched = await query([{ ids: wantList }], {
        signal: AbortSignal.any(signals),
      });
    } catch {
      // A failed hop fails open: leave the ids as "missing" for this pass so
      // the filter treats them as resolved-absent rather than forever-pending.
      for (const id of wantList) missing.add(id);
      break;
    }

    const fetchedById = new Map(fetched.map((e) => [e.id, e]));
    for (const id of wantList) {
      const ev = fetchedById.get(id);
      if (ev) cache.set(id, ev);
      else missing.add(id);
    }

    frontier = fetched;
  }

  return { cache, missing };
}
