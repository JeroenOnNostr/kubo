import { useMemo } from 'react';

import { useSearchEvents } from '@/hooks/useSearchEvents';
import { normalizeRelayUrl } from '@/lib/relayUrl';

/**
 * Relay discovery via the NIP-65 firehose (kind 10002). We extract `r`-tags
 * from user relay-list events on the pool, dedupe by normalized URL, and
 * rank by frequency (relays that appear in more users' lists come first).
 *
 * When `query` is a substring, filter client-side on the hostname. Relays
 * rarely index kind 10002 for NIP-50 search, so we don't rely on relay-side
 * search; `useSearchEvents` passes `search` in the filter anyway (harmless
 * no-op where unsupported).
 *
 * **Hard cap at MAX_RESULTS (default 50).** A single kind-10002 event can
 * carry 20–50 `r` tags, so a `{limit: 100}` query can easily yield 3000+
 * unique URLs. Rendering one row per URL crashed the browser via the
 * per-row NIP-11 HTTP fan-out — see KUBO-050/051 perf regression. The cap
 * keeps top-ranked relays (most-referenced) and discards the long tail.
 */

const MAX_RESULTS = 50;

export function useRelays(query: string, { limit = MAX_RESULTS }: { limit?: number } = {}) {
  const result = useSearchEvents({ kinds: [10002], query, limit: 100 });

  const ranked = useMemo<string[]>(() => {
    const counts = new Map<string, number>();
    for (const event of result.data ?? []) {
      for (const tag of event.tags) {
        if (tag[0] !== 'r' || !tag[1]) continue;
        const url = normalizeRelayUrl(tag[1]);
        if (!url) continue;
        counts.set(url, (counts.get(url) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([url]) => url);
  }, [result.data]);

  const filtered = useMemo<string[]>(() => {
    const q = query.trim().toLowerCase();
    const matching = q
      ? ranked.filter((url) => url.toLowerCase().includes(q))
      : ranked;
    return matching.slice(0, limit);
  }, [ranked, query, limit]);

  return { ...result, relays: filtered };
}
