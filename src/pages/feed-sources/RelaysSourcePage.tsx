import { useState, useCallback } from 'react';
import { Search, Server } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { BrowseSectionShell } from '@/components/feed/BrowseSectionShell';
import { ExpandableSourceRow } from '@/components/feed/ExpandableSourceRow';
import { NoKidSelected } from '@/components/NoKidSelected';
import { RelayBadges, RelayFooter } from '@/components/relays/RelayInfoPanel';
import { useBrowseRelays, type BrowseRelayEntry } from '@/hooks/useBrowseRelays';
import { useKidFeedSources } from '@/hooks/useKidFeedSources';
import { useRelayInfo } from '@/hooks/useRelayInfo';
import { useSelectedKid } from '@/hooks/useSelectedKid';
import { relayHostOf } from '@/lib/relayUrl';

import { FeedSourceHeader } from './_FeedSourceHeader';

/**
 * /parent/feed/relays — search, browse, and toggle "Places" (relay firehoses)
 * for the active kid. "Places" is the parent-facing label; the underlying
 * sources are Nostr relays.
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
  const { sources, toggleRelay } = useKidFeedSources(kid?.pubkey ?? null);
  const [query, setQuery] = useState('');

  const trimmedQuery = query.trim();

  // Browse list (discovered + baseline + pasted URL, minus enabled) is composed
  // by the shared useBrowseRelays hook, also used by Trust → Places (KUBO-211).
  const { entries: browseList, isFetching: relaysFetching } = useBrowseRelays(
    query,
    sources.relays,
  );

  if (!kid) return <NoKidSelected title="Places" />;

  return (
    <main className="flex flex-col">
      <FeedSourceHeader title={`Places · ${kid.displayName}`} />
      <div className="p-4 flex flex-col gap-4">
        <p className="text-[12px] text-muted-foreground px-1">
          Each enabled place — like a school or neighborhood — adds its posts
          to {kid.displayName}'s feed.
        </p>

        <div className="flex items-center gap-2 h-11 px-4 rounded-full bg-card">
          <Search className="size-4 text-muted-foreground" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search places or paste wss://…"
            className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-muted-foreground"
            aria-label="Search places"
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

type RelayBrowseEntry = BrowseRelayEntry;

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
          {query ? `No places found for "${query}".` : 'No places discovered yet.'}
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
