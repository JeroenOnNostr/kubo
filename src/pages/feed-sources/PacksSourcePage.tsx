import { useMemo, useState } from 'react';
import { Search, UsersRound } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { BrowseSectionShell } from '@/components/feed/BrowseSectionShell';
import { ExpandableSourceRow } from '@/components/feed/ExpandableSourceRow';
import { NoKidSelected } from '@/components/NoKidSelected';
import { useAddFeedPack } from '@/hooks/useAddFeedPack';
import {
  usePacks,
  usePacksByAtags,
  type PackByAtag,
} from '@/hooks/useFollowPacks';
import { useKidFeedSources } from '@/hooks/useKidFeedSources';
import { useSelectedKid } from '@/hooks/useSelectedKid';

import { FeedSourceHeader } from './_FeedSourceHeader';

/**
 * /parent/feed/packs — browse and toggle NIP-51 follow packs (kind 39089)
 * and follow sets (kind 30000) for the active kid.
 *
 * Layout (Stage 3):
 *   - search pill
 *   - "Enabled · N" section (currently-enabled packs/sets)
 *   - "Browse all" section (usePacks result, deduped against Enabled)
 */
export function PacksSourcePage() {
  const kid = useSelectedKid();
  const [query, setQuery] = useState('');
  const { sources } = useKidFeedSources(kid?.pubkey ?? null);
  // togglePack here also auto-grants view-only trust to pack members (KUBO-147).
  const { togglePack } = useAddFeedPack(kid?.pubkey);

  const { packs: browsePacks, isFetching: browseFetching } = usePacks(query);
  const { data: enabledByAtag } = usePacksByAtags(sources.packs);

  const enabledSet = useMemo(
    () => new Set(sources.packs),
    [sources.packs],
  );

  const browseResults = useMemo(
    () => browsePacks.filter((p) => !enabledSet.has(p.atag)),
    [browsePacks, enabledSet],
  );

  if (!kid) return <NoKidSelected title="Profile Lists" />;

  return (
    <main className="flex flex-col">
      <FeedSourceHeader title={`Profile Lists · ${kid.displayName}`} />
      <div className="p-4 flex flex-col gap-4">
        <p className="text-[12px] text-muted-foreground px-1">
          Enabled lists contribute their members' posts to
          {' '}{kid.displayName}'s feed aggregate.
        </p>

        <div className="flex items-center gap-2 h-11 px-4 rounded-full bg-card">
          <Search className="size-4 text-muted-foreground" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search lists…"
            className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-muted-foreground"
            aria-label="Search profile lists"
          />
        </div>

        {sources.packs.length > 0 && (
          <EnabledSection
            atags={sources.packs}
            byAtag={enabledByAtag}
            onToggle={(atag, event) => togglePack(atag, event)}
          />
        )}

        <BrowseSection
          results={browseResults}
          isFetching={browseFetching}
          query={query.trim()}
          onToggle={(atag, event) => togglePack(atag, event)}
        />
      </div>
    </main>
  );
}

function EnabledSection({
  atags,
  byAtag,
  onToggle,
}: {
  atags: string[];
  byAtag?: Map<string, PackByAtag>;
  onToggle: (atag: string, event?: NostrEvent) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Enabled · {atags.length}
      </div>
      <div className="flex flex-col gap-2">
        {atags.map((atag) => {
          const pack = byAtag?.get(atag);
          return (
            <PackRow
              key={atag}
              atag={atag}
              pack={pack}
              enabled
              onToggle={() => onToggle(atag, pack?.event)}
            />
          );
        })}
      </div>
    </div>
  );
}

function BrowseSection({
  results,
  isFetching,
  query,
  onToggle,
}: {
  results: PackByAtag[];
  isFetching: boolean;
  query: string;
  onToggle: (atag: string, event?: NostrEvent) => void;
}) {
  return (
    <BrowseSectionShell count={results.length} forceOpen={query.length > 0}>
      {isFetching && results.length === 0 ? (
        <EmptyState>Searching…</EmptyState>
      ) : results.length === 0 ? (
        <EmptyState>
          {query ? `No lists found for "${query}".` : 'No lists discovered yet.'}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {results.map((pack) => (
            <PackRow
              key={pack.atag}
              atag={pack.atag}
              pack={pack}
              enabled={false}
              onToggle={() => onToggle(pack.atag, pack.event)}
            />
          ))}
        </div>
      )}
    </BrowseSectionShell>
  );
}

function PackRow({
  atag,
  pack,
  enabled,
  onToggle,
}: {
  atag: string;
  pack: PackByAtag | undefined;
  enabled: boolean;
  onToggle: () => void;
}) {
  const title = pack?.title ?? fallbackTitle(atag);
  const memberCount = pack
    ? pack.event.tags.filter((t) => t[0] === 'p' && !!t[1]).length
    : 0;
  const subtitle = pack
    ? `${memberCount} ${memberCount === 1 ? 'member' : 'members'}`
    : undefined;
  const description = pack?.event.tags.find(
    (t) => t[0] === 'description' || t[0] === 'about' || t[0] === 'summary',
  )?.[1];

  return (
    <ExpandableSourceRow
      rowKey={atag}
      avatar={
        <Avatar className="size-9 border border-border/70">
          <AvatarImage src={pack?.image} alt="" />
          <AvatarFallback>
            <UsersRound className="size-4 text-muted-foreground" />
          </AvatarFallback>
        </Avatar>
      }
      title={title}
      subtitle={subtitle}
      description={description}
      enabled={enabled}
      onToggle={onToggle}
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

function fallbackTitle(atag: string): string {
  return atag.split(':').slice(2).join(':') || 'List';
}
