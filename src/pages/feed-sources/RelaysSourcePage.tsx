import { useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Mail, Search, Server, Shield, Zap } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ExpandableSourceRow } from '@/components/feed/ExpandableSourceRow';
import { NoKidSelected } from '@/components/NoKidSelected';
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
  const browseList = useMemo<string[]>(() => {
    const seen = new Set<string>([...enabledSet]);
    const out: string[] = [];
    const push = (url: string) => {
      if (seen.has(url)) return;
      seen.add(url);
      out.push(url);
    };

    // Synthetic "pasted URL" row first — if query looks like a URL and isn't
    // already enabled or in the list.
    if (pastedUrl) {
      push(pastedUrl);
    }

    for (const url of discoveredRelays) push(url);

    // Filter baseline by query substring so search behaviour is consistent.
    const q = trimmedQuery.toLowerCase();
    for (const url of baselineRelays) {
      if (!q || url.toLowerCase().includes(q)) push(url);
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
          urls={browseList}
          isFetching={relaysFetching}
          query={trimmedQuery}
          onToggle={(url) => toggleRelay(url)}
        />
      </div>
    </main>
  );
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
            url={url}
            enabled
            onToggle={() => onToggle(url)}
          />
        ))}
      </div>
    </div>
  );
}

function BrowseSection({
  urls,
  isFetching,
  query,
  onToggle,
}: {
  urls: string[];
  isFetching: boolean;
  query: string;
  onToggle: (url: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Browse all
      </div>
      {isFetching && urls.length === 0 ? (
        <EmptyState>Searching…</EmptyState>
      ) : urls.length === 0 ? (
        <EmptyState>
          {query ? `No relays found for "${query}".` : 'No relays discovered yet.'}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {urls.map((url) => (
            <RelayRow
              key={url}
              url={url}
              enabled={false}
              onToggle={() => onToggle(url)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RelayRow({
  url,
  enabled,
  onToggle,
}: {
  url: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  // Lazy NIP-11 fetch (KUBO-054 perf fix). The HTTP fan-out was the
  // culprit behind the page freeze — 50 rows × one HTTP request per row
  // was too much on mobile. Now:
  //  - Enabled rows fetch eagerly (the user explicitly chose them, small N).
  //  - Browse rows fetch only after first expand; stays "activated" across
  //    collapse so re-expanding is instant.
  const [activated, setActivated] = useState<boolean>(enabled);
  const handleOpenChange = useCallback((open: boolean) => {
    if (open) setActivated(true);
  }, []);
  const { data: relayInfo } = useRelayInfo(activated ? url : undefined);
  const relayName = relayInfo?.name?.trim() || relayHostOf(url);

  return (
    <ExpandableSourceRow
      rowKey={url}
      avatar={
        <Avatar className="size-9 border border-border/70">
          <AvatarImage src={relayInfo?.icon} alt="" />
          <AvatarFallback>
            <Server className="size-4 text-muted-foreground" />
          </AvatarFallback>
        </Avatar>
      }
      title={relayName}
      subtitle={url}
      badges={<RelayBadges info={relayInfo} />}
      description={relayInfo?.description}
      footer={<RelayFooter url={url} info={relayInfo} />}
      enabled={enabled}
      onToggle={onToggle}
      onOpenChange={handleOpenChange}
    />
  );
}

function RelayBadges({ info }: { info: RelayInfoDocument | undefined }) {
  const paymentRequired = Boolean(
    info?.limitation?.payment_required ?? info?.payment_required,
  );
  const authRequired = Boolean(
    info?.limitation?.auth_required ?? info?.auth_required,
  );
  const notableNips = (info?.supported_nips ?? []).filter(
    (nip) => nip === 42 || nip === 50,
  );
  if (!paymentRequired && !authRequired && notableNips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {notableNips.includes(50) && (
        <Badge variant="outline" className="text-[10px]">NIP-50</Badge>
      )}
      {notableNips.includes(42) && (
        <Badge variant="outline" className="text-[10px]">NIP-42</Badge>
      )}
      {authRequired && (
        <Badge variant="secondary" className="gap-1 text-[10px]">
          <Shield className="size-2.5" />
          Auth
        </Badge>
      )}
      {paymentRequired && (
        <Badge variant="secondary" className="gap-1 text-[10px]">
          <Zap className="size-2.5" />
          Paid
        </Badge>
      )}
    </div>
  );
}

function RelayFooter({
  url,
  info,
}: {
  url: string;
  info: RelayInfoDocument | undefined;
}) {
  const contact = info?.contact?.trim();
  const encoded = encodeURIComponent(url);
  return (
    <div className="flex flex-wrap gap-3 text-[12px]">
      {contact && (
        <a
          href={contact.includes('@') ? `mailto:${contact}` : contact}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          <Mail className="size-3" />
          {contact}
        </a>
      )}
      <Link
        to={`/r/${encoded}`}
        className="inline-flex items-center gap-1 text-primary hover:underline"
      >
        <ExternalLink className="size-3" />
        Visit relay
      </Link>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-card p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
