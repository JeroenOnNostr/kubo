import { useMemo } from 'react';

import { useAppContext } from '@/hooks/useAppContext';
import type { DiscoveredRelay } from '@/hooks/useRelayDiscovery';
import { useRelays } from '@/hooks/useRelays';
import type { RelayInfoDocument } from '@/hooks/useRelayInfo';
import { APP_RELAYS } from '@/lib/appRelays';
import { normalizeRelayUrl } from '@/lib/relayUrl';

/**
 * One candidate relay in a "browse / add" list.
 *
 * `info` carries inline NIP-11 metadata when the relay came from the NIP-66
 * discovery monitor (kind-30166); it is absent for baseline rows (the parent's
 * NIP-65 + APP_RELAYS) and pasted-URL rows, which lazy-fetch NIP-11 on demand.
 */
export interface BrowseRelayEntry {
  url: string;
  info?: RelayInfoDocument;
}

/**
 * Pure composition of the browse list. Extracted from the hook so the ordering
 * and dedupe semantics (the crux of KUBO-211) are unit-testable without React.
 *
 * Order matters — first-seen wins on dedupe:
 *   1. A pasted `wss://` URL (already normalized, or null).
 *   2. The discovered NIP-66 catalogue (carrying inline NIP-11).
 *   3. The baseline (NIP-65 + APP_RELAYS), substring-filtered by `query`.
 * Anything in `excludeUrls` is dropped (renders in the caller's Enabled list).
 */
export function composeBrowseRelays(input: {
  query: string;
  pastedUrl: string | null;
  discoveredRelays: DiscoveredRelay[];
  baselineRelays: string[];
  excludeUrls: Iterable<string>;
}): BrowseRelayEntry[] {
  const { query, pastedUrl, discoveredRelays, baselineRelays, excludeUrls } = input;
  const seen = new Set<string>(excludeUrls);
  const out: BrowseRelayEntry[] = [];
  const push = (entry: BrowseRelayEntry) => {
    if (seen.has(entry.url)) return;
    seen.add(entry.url);
    out.push(entry);
  };

  if (pastedUrl) push({ url: pastedUrl });

  for (const r of discoveredRelays) push({ url: r.url, info: r.info });

  const q = query.trim().toLowerCase();
  for (const url of baselineRelays) {
    if (!q || url.toLowerCase().includes(q)) push({ url });
  }
  return out;
}

/**
 * Compose the "browse all" relay list shared by Feed → Sources → Places
 * (RelaysSourcePage) and Trust → Places (TrustPlacesPage). Previously this
 * lived inline in RelaysSourcePage; Trust → Places used the bare discovery
 * catalogue only, so relays like relay.damus.io that the monitor hasn't
 * recently announced never surfaced there (KUBO-211).
 *
 * Composition (order matters — first-seen wins on dedupe):
 *   1. A pasted `wss://` URL (if `query` normalizes to a relay URL).
 *   2. The NIP-66 discovery catalogue (ranked by useRelays), carrying inline
 *      NIP-11 so rows skip the per-row HTTP fetch (KUBO-054).
 *   3. The baseline — the parent's NIP-65 relays + APP_RELAYS (when
 *      `config.useAppRelays`) — substring-filtered by the query. This is the
 *      origin that guarantees app/personal relays are always searchable,
 *      independent of monitor coverage.
 *
 * `excludeUrls` are skipped (Trust passes its assigned-relay keys, Feed passes
 * its enabled-relay set) so those render in their own "Enabled" section rather
 * than Browse.
 */
export function useBrowseRelays(
  query: string,
  excludeUrls: Iterable<string>,
): { entries: BrowseRelayEntry[]; isFetching: boolean } {
  const { config } = useAppContext();
  const { relays: discoveredRelays, isFetching } = useRelays(query);

  const trimmedQuery = query.trim();
  const pastedUrl = useMemo(
    () => (trimmedQuery ? normalizeRelayUrl(trimmedQuery) : null),
    [trimmedQuery],
  );

  // Baseline candidate list: user's NIP-65 + APP_RELAYS. Always included so
  // app/personal relays are searchable even before (or without) discovery.
  const baselineRelays = useMemo<string[]>(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const push = (url: string) => {
      const normalized = normalizeRelayUrl(url);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      out.push(normalized);
    };
    for (const r of config.relayMetadata.relays) push(r.url);
    if (config.useAppRelays) {
      for (const r of APP_RELAYS.relays) push(r.url);
    }
    return out;
  }, [config.relayMetadata.relays, config.useAppRelays]);

  // `excludeUrls` is an iterable; materialize once for stable memo deps.
  const excludeKey = useMemo(() => [...excludeUrls].join('\n'), [excludeUrls]);

  const entries = useMemo<BrowseRelayEntry[]>(
    () =>
      composeBrowseRelays({
        query,
        pastedUrl,
        discoveredRelays,
        baselineRelays,
        excludeUrls: excludeKey ? excludeKey.split('\n') : [],
      }),
    [query, pastedUrl, discoveredRelays, baselineRelays, excludeKey],
  );

  return { entries, isFetching };
}
