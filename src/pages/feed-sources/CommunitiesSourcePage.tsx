import { useMemo, useState } from 'react';
import { Search, UsersRound } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { BrowseSectionShell } from '@/components/feed/BrowseSectionShell';
import { ExpandableSourceRow } from '@/components/feed/ExpandableSourceRow';
import { NoKidSelected } from '@/components/NoKidSelected';
import {
  useCommunities,
  useCommunitiesByAtags,
  type ParsedCommunity,
} from '@/hooks/useCommunities';
import { useKidFeedSources } from '@/hooks/useKidFeedSources';
import { useSelectedKid } from '@/hooks/useSelectedKid';

import { FeedSourceHeader } from './_FeedSourceHeader';

/**
 * /parent/feed/communities — browse and toggle NIP-72 communities
 * (kind 34550) for the active kid. Search uses NIP-50 on the relay pool;
 * empty query returns a top-100 firehose.
 *
 * Layout (Stage 3):
 *   - search pill
 *   - "Enabled · N" section (currently-enabled communities)
 *   - "Browse all" section (search results, deduped against Enabled)
 */
export function CommunitiesSourcePage() {
  const kid = useSelectedKid();
  const [query, setQuery] = useState('');
  const { communities, isFetching } = useCommunities(query);
  const { sources, toggleCommunity } = useKidFeedSources(kid?.pubkey ?? null);

  // Batch-resolve metadata for currently-enabled a-tags (M1 cache).
  const { data: enabledByAtag } = useCommunitiesByAtags(sources.communities);

  const enabledSet = useMemo(
    () => new Set(sources.communities),
    [sources.communities],
  );

  const browseResults = useMemo(
    () => communities.filter((c) => !enabledSet.has(c.atag)),
    [communities, enabledSet],
  );

  if (!kid) return <NoKidSelected title="Communities" />;

  return (
    <main className="flex flex-col">
      <FeedSourceHeader title={`Communities · ${kid.displayName}`} />
      <div className="p-4 flex flex-col gap-4">
        <p className="text-[12px] text-muted-foreground px-1">
          Enabled communities contribute their posts to {kid.displayName}'s
          feed aggregate.
        </p>

        <div className="flex items-center gap-2 h-11 px-4 rounded-full bg-card">
          <Search className="size-4 text-muted-foreground" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search communities…"
            className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-muted-foreground"
            aria-label="Search communities"
          />
        </div>

        {sources.communities.length > 0 && (
          <EnabledSection
            atags={sources.communities}
            byAtag={enabledByAtag}
            onToggle={(atag) => toggleCommunity(atag)}
          />
        )}

        <BrowseSection
          results={browseResults}
          isFetching={isFetching}
          query={query.trim()}
          onToggle={(atag) => toggleCommunity(atag)}
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
  byAtag?: Map<string, ParsedCommunity>;
  onToggle: (atag: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Enabled · {atags.length}
      </div>
      <div className="flex flex-col gap-2">
        {atags.map((atag) => {
          const community = byAtag?.get(atag);
          return (
            <CommunityRow
              key={atag}
              atag={atag}
              community={community}
              enabled
              onToggle={() => onToggle(atag)}
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
  results: ParsedCommunity[];
  isFetching: boolean;
  query: string;
  onToggle: (atag: string) => void;
}) {
  return (
    <BrowseSectionShell count={results.length} forceOpen={query.length > 0}>
      {isFetching && results.length === 0 ? (
        <EmptyState>Searching…</EmptyState>
      ) : results.length === 0 ? (
        <EmptyState>
          {query
            ? `No communities found for "${query}".`
            : 'No communities discovered yet.'}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {results.map((community) => (
            <CommunityRow
              key={community.atag}
              atag={community.atag}
              community={community}
              enabled={false}
              onToggle={() => onToggle(community.atag)}
            />
          ))}
        </div>
      )}
    </BrowseSectionShell>
  );
}

function CommunityRow({
  atag,
  community,
  enabled,
  onToggle,
}: {
  atag: string;
  community: ParsedCommunity | undefined;
  enabled: boolean;
  onToggle: () => void;
}) {
  const title = community?.name ?? fallbackTitle(atag);
  const description = community?.description;
  return (
    <ExpandableSourceRow
      rowKey={atag}
      avatar={
        <Avatar className="size-9 border border-border/70">
          <AvatarImage src={community?.image} alt="" />
          <AvatarFallback>
            <UsersRound className="size-4 text-muted-foreground" />
          </AvatarFallback>
        </Avatar>
      }
      title={title}
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
  return atag.split(':').slice(2).join(':') || 'Community';
}
