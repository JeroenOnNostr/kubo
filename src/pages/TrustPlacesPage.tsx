import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';

import { BrowseSectionShell } from '@/components/feed/BrowseSectionShell';
import { NoKidSelected } from '@/components/NoKidSelected';
import { Input } from '@/components/ui/input';
import { TrustHeader } from '@/pages/TrustPeoplePage';
import { TrustLegend } from '@/components/trust/TrustLegend';
import { TrustRelayRow } from '@/components/trust/TrustRelayRow';
import { useBrowseRelays } from '@/hooks/useBrowseRelays';
import { useDebounce } from '@/hooks/useDebounce';
import type { DiscoveredRelay } from '@/hooks/useRelayDiscovery';
import { useRelays } from '@/hooks/useRelays';
import { useRelayTrustAssignments } from '@/hooks/useRelayTrustAssignments';
import { useSelectedKid } from '@/hooks/useSelectedKid';
import { type KuboTrustLevel } from '@/hooks/useKuboFamily';
import { relayHostOf } from '@/lib/relayUrl';

/**
 * /parent/trust/places — Places tab of the Trust domain.
 *
 * Mirrors the feed-source pages (Relays, Communities, Packs):
 *   - "Enabled · N" section: relays the parent has assigned any trust level
 *     to. Sorted by level (extend → interact → view), then alphabetical.
 *   - "Browse all" section: NIP-66 discovery catalogue, minus already-assigned
 *     relays. Collapsed by default to reduce visual clutter; auto-expands
 *     when the search bar has text.
 */
export function TrustPlacesPage() {
  const kid = useSelectedKid();
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, 300);
  // `discovered` (NIP-66 catalogue) is kept only to hydrate NIP-11 metadata
  // for already-assigned relays in the Enabled section. The Browse list is
  // composed by the shared useBrowseRelays hook (KUBO-211).
  const { relays: discovered } = useRelays(debounced);
  const { assigned } = useRelayTrustAssignments(kid?.pubkey);

  const assignedKeys = useMemo(() => Object.keys(assigned), [assigned]);
  const { entries: browseEntries, isFetching } = useBrowseRelays(debounced, assignedKeys);

  const trimmed = debounced.trim();

  // Enabled section: every assigned relay, hydrated from the discovery
  // cache when available so we have NIP-11 metadata; falls back to a
  // synthetic record (URL only) when not.
  const enabledList = useMemo(() => {
    const lookup = new Map<string, DiscoveredRelay>();
    for (const r of discovered) lookup.set(r.url, r);
    const levelRank: Record<KuboTrustLevel, number> = { extend: 0, interact: 1, view: 2 };
    type Entry = { relay: DiscoveredRelay; level: KuboTrustLevel; sortKey: string };
    const out: Entry[] = [];
    for (const [url, level] of Object.entries(assigned)) {
      const relay: DiscoveredRelay =
        lookup.get(url) ?? { url, info: {}, network: 'unknown', monitoredAt: 0 };
      const sortKey = (relay.info.name?.trim() || relayHostOf(url)).toLowerCase();
      out.push({ relay, level, sortKey });
    }
    out.sort((a, b) => {
      const ra = levelRank[a.level];
      const rb = levelRank[b.level];
      if (ra !== rb) return ra - rb;
      return a.sortKey.localeCompare(b.sortKey);
    });
    return out;
  }, [assigned, discovered]);

  // Browse all: the shared browse list (discovery catalogue + NIP-65/APP_RELAYS
  // baseline + pasted wss:// URL), already excluding assigned relays. Map each
  // entry to the DiscoveredRelay shape TrustRelayRow expects; baseline/pasted
  // rows carry empty info and lazy-fetch NIP-11 on first expand.
  const browseList = useMemo<DiscoveredRelay[]>(
    () =>
      browseEntries.map((entry) => ({
        url: entry.url,
        info: entry.info ?? {},
        network: 'unknown',
        monitoredAt: 0,
      })),
    [browseEntries],
  );

  if (!kid) {
    return <NoKidSelected title="Trust · Places" />;
  }

  return (
    <div className="flex flex-col gap-3 px-4 pt-2 pb-6">
      <TrustHeader active="places" />

      <TrustLegend kidName={kid.displayName} scope="places" className="mt-1" />

      <div className="relative flex items-center">
        <Search className="absolute left-3 size-4 text-muted-foreground pointer-events-none" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search places…"
          className="pl-10 pr-3 rounded-full bg-card border-0 h-9 text-[12px] focus-visible:ring-0 focus-visible:ring-offset-0"
        />
      </div>

      {enabledList.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Enabled · {enabledList.length}
          </div>
          {enabledList.map(({ relay, level }) => (
            <TrustRelayRow
              key={relay.url}
              relay={relay}
              kidPubkey={kid.pubkey}
              assigned={level}
            />
          ))}
        </div>
      )}

      <BrowseSectionShell count={browseList.length} forceOpen={trimmed.length > 0}>
        {isFetching && browseList.length === 0 ? (
          <EmptyLine>Searching…</EmptyLine>
        ) : browseList.length === 0 ? (
          <EmptyLine>{trimmed ? `No places found for "${trimmed}".` : 'No places discovered yet.'}</EmptyLine>
        ) : (
          <div className="flex flex-col gap-2">
            {browseList.map((relay) => (
              <TrustRelayRow
                key={relay.url}
                relay={relay}
                kidPubkey={kid.pubkey}
                assigned={undefined}
              />
            ))}
          </div>
        )}
      </BrowseSectionShell>
    </div>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <div className="text-[12px] text-muted-foreground px-1 py-2">{children}</div>;
}
