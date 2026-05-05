import { useMemo, useState, useCallback } from 'react';
import { Search, Server } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { BrowseSectionShell } from '@/components/feed/BrowseSectionShell';
import { ExpandableSourceRow } from '@/components/feed/ExpandableSourceRow';
import { NoKidSelected } from '@/components/NoKidSelected';
import { RelayBadges, RelayFooter } from '@/components/relays/RelayInfoPanel';
import { useAppContext } from '@/hooks/useAppContext';
import { useKidFeedSources } from '@/hooks/useKidFeedSources';
import { useRelayInfo, type RelayInfoDocument } from '@/hooks/useRelayInfo';
import { useRelays } from '@/hooks/useRelays';
import { useSelectedKid } from '@/hooks/useSelectedKid';
import { APP_RELAYS } from '@/lib/appRelays';
import { normalizeRelayUrl, relayHostOf } from '@/lib/relayUrl';

import { FeedSourceHeader } from './_FeedSourceHeader';

/**
 * /parent/feed/relays — search, browse, and toggle relay firehoses for the
 * active kid.
 *
 * Layout (Stage 3):
 *   - search pill (also accepts pasted wss:// URLs — shown as a synthetic
 *     row at the top of Browse)
 *   - "Enabled · N" section
 *   - "Browse all" section — kind-10002 firehose ranked by frequency, plus
 *     the parent's NIP-65 relays + APP_RELAYS as a baseline when no search
 *     results are available yet.
 */
export function RelaysSourcePage() {
  const kid = useSelectedKid();
  const { config } = useAppContext();
  const { sources, toggleRelay } = useKidFeedSources(kid?.pubkey ?? null);
  const [query, setQuery] = useState('');

  const trimmedQuery = query.trim();
  const pastedUrl = useMemo(
    () => (trimmedQuery ? normalizeRelayUrl(trimmedQuery) : null),
    [trimmedQuery],
  );

  const { relays: discoveredRelays, isFetching: relaysFetching } = useRelays(query);

  // Baseline candidate list: user's NIP-65 + APP_RELAYS. Always included so
  // empty-query users see something even before the firehose lands.
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

  const enabledSet = useMemo(() => new Set(sources.relays), [sources.relays]);

  // Compose the browse list: discovered (ranked) first, then baseline
  // relays that aren't already in the discovered list, minus anything the
  // user has already enabled (those render in the Enabled section).
  // Discovered rows carry inline NIP-11 from kind-30166 so RelayRow can
  // skip the per-row HTTP fetch (KUBO-054); baseline rows have no info and
  // fall back to the lazy fetch.
  const browseList = useMemo<RelayBrowseEntry[]>(() => {
    const seen = new Set<string>([...enabledSet]);
    const out: RelayBrowseEntry[] = [];
    const push = (entry: RelayBrowseEntry) => {
      if (seen.has(entry.url)) return;
      seen.add(entry.url);
      out.push(entry);
    };

    if (pastedUrl) {
      push({ url: pastedUrl });
    }

    for (const r of discoveredRelays) push({ url: r.url, info: r.info });

    const q = trimmedQuery.toLowerCase();
    for (const url of baselineRelays) {
      if (!q || url.toLowerCase().includes(q)) push({ url });
    }
    return out;
  }, [pastedUrl, discoveredRelays, baselineRelays, enabledSet, trimmedQuery]);

  if (!kid) return <NoKidSelected title="Relays" />;

  return (
    <main className="flex flex-col">
      <FeedSourceHeader title={`Relays · ${kid.displayName}`} />
      <div className="p-4 flex flex-col gap-4">
        <p className="text-[12px] text-muted-foreground px-1">
          Each enabled relay contributes its global firehose to {kid.displayName}'s
          feed aggregate.
        </p>

        <div className="flex items-center gap-2 h-11 px-4 rounded-full bg-card">
          <Search className="size-4 text-muted-foreground" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search relays or paste wss://…"
            className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-muted-foreground"
            aria-label="Search relays"
          />
        </div>

        {sources.relays.length > 0 && (
          <EnabledSection
            urls={sources.relays}
            onToggle={(url) => toggleRelay(url)}
          />
        )}

        <BrowseSection
          entries={browseList}
          isFetching={relaysFetching}
          query={trimmedQuery}
          onToggle={(url) => toggleRelay(url)}
        />
      </div>
    </main>
  );
}

interface RelayBrowseEntry {
  url: string;
  /** Inline NIP-11 from NIP-66 monitor; absent for baseline rows. */
  info?: RelayInfoDocument;
}

function EnabledSection({
  urls,
  onToggle,
}: {
  urls: string[];
  onToggle: (url: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Enabled · {urls.length}
      </div>
      <div className="flex flex-col gap-2">
        {urls.map((url) => (
          <RelayRow
            key={url}
            entry={{ url }}
            enabled
            onToggle={() => onToggle(url)}
          />
        ))}
      </div>
    </div>
  );
}

function BrowseSection({
  entries,
  isFetching,
  query,
  onToggle,
}: {
  entries: RelayBrowseEntry[];
  isFetching: boolean;
  query: string;
  onToggle: (url: string) => void;
}) {
  return (
    <BrowseSectionShell count={entries.length} forceOpen={query.length > 0}>
      {isFetching && entries.length === 0 ? (
        <EmptyState>Searching…</EmptyState>
      ) : entries.length === 0 ? (
        <EmptyState>
          {query ? `No relays found for "${query}".` : 'No relays discovered yet.'}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map((entry) => (
            <RelayRow
              key={entry.url}
              entry={entry}
              enabled={false}
              onToggle={() => onToggle(entry.url)}
            />
          ))}
        </div>
      )}
    </BrowseSectionShell>
  );
}

function RelayRow({
  entry,
  enabled,
  onToggle,
}: {
  entry: RelayBrowseEntry;
  enabled: boolean;
  onToggle: () => void;
}) {
  // NIP-11 metadata: prefer inline info from the NIP-66 monitor (no HTTP
  // fetch needed). Fall back to lazy useRelayInfo for baseline relays
  // (parent's NIP-65 + APP_RELAYS) and enabled rows that aren't in the
  // discovery set. Enabled rows fetch eagerly (small N, user-chosen);
  // browse rows fetch only after first expand (KUBO-054 perf fix).
  const hasInlineInfo = !!entry.info;
  const [activated, setActivated] = useState<boolean>(enabled || hasInlineInfo);
  const handleOpenChange = useCallback((open: boolean) => {
    if (open) setActivated(true);
  }, []);
  const { data: fetchedInfo } = useRelayInfo(
    !hasInlineInfo && activated ? entry.url : undefined,
  );
  const relayInfo = entry.info ?? fetchedInfo;
  const relayName = relayInfo?.name?.trim() || relayHostOf(entry.url);

  // Match the Trust→Places row style: collapsed shows avatar + name + host
  // (no wss:// prefix, no badges); badges move into the expanded body next
  // to the Visit/contact links so the row stays scannable.
  return (
    <ExpandableSourceRow
      rowKey={entry.url}
      avatar={
        <Avatar className="size-9 border border-border/70">
          <AvatarImage src={relayInfo?.icon} alt="" />
          <AvatarFallback>
            <Server className="size-4 text-muted-foreground" />
          </AvatarFallback>
        </Avatar>
      }
      title={relayName}
      subtitle={relayHostOf(entry.url)}
      description={relayInfo?.description}
      footer={
        <div className="flex flex-col gap-2">
          <RelayBadges info={relayInfo} />
          <RelayFooter url={entry.url} info={relayInfo} />
        </div>
      }
      enabled={enabled}
      onToggle={onToggle}
      onOpenChange={handleOpenChange}
    />
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-card p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
