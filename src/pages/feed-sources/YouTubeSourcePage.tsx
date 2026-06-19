import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, MonitorPlay, Loader2, Plus, Trash2, RotateCcw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { BrowseSectionShell } from '@/components/feed/BrowseSectionShell';
import { NoKidSelected } from '@/components/NoKidSelected';
import { useSelectedKid } from '@/hooks/useSelectedKid';
import { useToast } from '@/hooks/useToast';
import {
  useYouTubeChannels,
  type YouTubeChannelEntry,
} from '@/hooks/useYouTubeChannels';
import {
  useYouTubeDvm,
  YouTubeDvmError,
  YouTubeDvmTimeoutError,
  type SearchResult,
} from '@/lib/youtubeDvm';

import { FeedSourceHeader } from './_FeedSourceHeader';

/**
 * /parent/feed/youtube — search for YouTube channels via the bridge DVM and add
 * them to the active kid's feed.
 *
 * Discovery is over Nostr (the DVM publishes results on the same relays Kubo
 * uses — incl. wss://relay.kubo.watch), NOT over HTTP. Adding a channel persists
 * a ref AND grants the channel's bridge npub `view` trust + a kid kind-3 follow,
 * so its kind-21 video events flow into the feed through the existing TEPP
 * query-scoping (same grant path as the Profiles page, KUBO-147).
 *
 * Layout (mirrors ProfilesSourcePage / RelaysSourcePage):
 *   - search box (name, YouTube URL, or @handle — the DVM resolves all three)
 *   - result cards with "Add to {kid}'s feed"
 *   - "Active" section (enabled channels, Switch to disable)
 *   - "Removed / available to re-add" section (collapsed; re-enable or forget)
 */
export function YouTubeSourcePage() {
  const kid = useSelectedKid();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const dvm = useYouTubeDvm();
  const { active, removed, addChannel, setEnabled, forgetChannel, isPending } =
    useYouTubeChannels(kid?.pubkey);

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  /**
   * npubs of channels whose bridge watch (video backfill) is still in flight.
   * The channel is already in the Active list (optimistic add); this just drives
   * the "fetching videos…" sub-label on its row.
   */
  const [syncingNpubs, setSyncingNpubs] = useState<Set<string>>(new Set());

  const invalidateFeed = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['kid-feed'] });
    queryClient.invalidateQueries({ queryKey: ['feed', 'follows'] });
  }, [queryClient]);

  /** Token of the latest issued search, so a slow earlier response can't
   *  overwrite results for a query the user has since changed. */
  const searchSeq = useRef(0);

  const runSearch = useCallback(
    async (raw: string, { silent }: { silent?: boolean } = {}) => {
      const q = raw.trim();
      if (!q) return;
      if (!dvm.ready) {
        // Only nag about parent login on an explicit Search press, not while typing.
        if (!silent) {
          toast({
            title: 'Log in as the parent',
            description: 'Adding YouTube channels has to be done from the parent account.',
            variant: 'destructive',
          });
        }
        return;
      }
      const seq = ++searchSeq.current;
      setSearching(true);
      setResults(null);
      try {
        const found = await dvm.search(q);
        if (seq !== searchSeq.current) return; // a newer search superseded this one
        setResults(found);
      } catch (err) {
        if (seq !== searchSeq.current) return;
        // Debounced (typing) searches fail quietly — only explicit presses toast.
        if (!silent) {
          if (err instanceof YouTubeDvmTimeoutError) {
            toast({ title: 'YouTube search timed out', description: err.message, variant: 'destructive' });
          } else if (err instanceof YouTubeDvmError) {
            toast({ title: 'YouTube search failed', description: err.message, variant: 'destructive' });
          } else {
            toast({
              title: 'YouTube search failed',
              description: err instanceof Error ? err.message : String(err),
              variant: 'destructive',
            });
          }
        }
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    },
    [dvm, toast],
  );

  const handleSearch = useCallback(() => runSearch(query), [runSearch, query]);

  // Keep the latest runSearch in a ref so the debounce effect can depend ONLY on
  // `query`. Depending on `runSearch` directly would re-fire the effect whenever
  // its identity churns (a parent re-render, an upstream hook returning a fresh
  // value) — which, combined with the setState inside runSearch, becomes a
  // render→search→setState→render loop. The ref breaks that cycle.
  const runSearchRef = useRef(runSearch);
  useEffect(() => {
    runSearchRef.current = runSearch;
  }, [runSearch]);

  // Search-as-you-type: debounce ~350ms after the user stops typing (≥2 chars).
  // The HTTP fast lane + client/bridge caches make this feel live; failures are
  // silent so a half-typed query doesn't spam toasts.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const t = setTimeout(() => runSearchRef.current(q, { silent: true }), 350);
    return () => clearTimeout(t);
  }, [query]);

  const handleAdd = useCallback(
    async (result: SearchResult) => {
      // OPTIMISTIC ADD: the channel's npub/title/picture are already in the
      // search result, so persist the ref + grant trust/follow FIRST. The row
      // jumps into Active immediately (addChannel is idempotent on npub). Then
      // ask the bridge to start watching + backfill in the background — the
      // videos trickle in; we don't make the parent wait on it.
      try {
        await addChannel({
          npub: result.npub,
          channelId: result.channelId,
          title: result.title,
          picture: result.thumbnail,
        });
      } catch (err) {
        toast({
          title: "Couldn't add channel",
          description: err instanceof Error ? err.message : String(err),
          variant: 'destructive',
        });
        return;
      }

      invalidateFeed();
      toast({
        title: `Added to ${kid?.displayName ?? 'the'} feed`,
        description: 'Fetching videos — new channels can take a few minutes to appear.',
      });

      // Mark the row as syncing while the bridge watch (backfill) runs.
      setSyncingNpubs((prev) => new Set(prev).add(result.npub));
      try {
        await dvm.watch({ channelId: result.channelId, thumbnail: result.thumbnail });
        // Videos may have landed — refetch so they show without a manual reload.
        invalidateFeed();
      } catch (err) {
        // The channel is already added; a watch failure just means the backfill
        // didn't kick off now (the bridge's 15-min cron still owns future
        // uploads). Surface it softly rather than as a hard "couldn't add".
        const message =
          err instanceof YouTubeDvmTimeoutError || err instanceof YouTubeDvmError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        toast({
          title: 'Channel added — videos may be delayed',
          description: message,
        });
      } finally {
        setSyncingNpubs((prev) => {
          const next = new Set(prev);
          next.delete(result.npub);
          return next;
        });
      }
    },
    [dvm, addChannel, invalidateFeed, toast, kid?.displayName],
  );

  const handleSetEnabled = useCallback(
    async (npub: string, on: boolean) => {
      await setEnabled(npub, on);
      invalidateFeed();
    },
    [setEnabled, invalidateFeed],
  );

  const handleForget = useCallback(
    async (npub: string) => {
      await forgetChannel(npub);
      invalidateFeed();
    },
    [forgetChannel, invalidateFeed],
  );

  if (!kid) return <NoKidSelected title="YouTube Channels" />;

  // Hide search results that are already in the kid's list (active or removed),
  // so the cards focus on genuinely new channels to add.
  const knownNpubs = new Set([...active, ...removed].map((c) => c.npub));
  const visibleResults = results?.filter((r) => !knownNpubs.has(r.npub)) ?? null;

  return (
    <main className="flex flex-col">
      <FeedSourceHeader title={`YouTube · ${kid.displayName}`} />
      <div className="p-4 flex flex-col gap-4">
        <p className="text-[12px] text-muted-foreground px-1">
          Search for a YouTube channel; its videos then appear in {kid.displayName}'s
          feed. You can paste a channel name, URL, or @handle.
        </p>

        {/* Search box */}
        <div className="flex items-center gap-2 h-11 px-4 rounded-full bg-card">
          <Search className="size-4 text-muted-foreground" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch();
            }}
            placeholder="Search YouTube channels…"
            className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-muted-foreground"
            aria-label="Search YouTube channels"
          />
          {searching ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
          ) : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 rounded-full px-3 text-[12px]"
              onClick={handleSearch}
              disabled={!query.trim()}
            >
              Search
            </Button>
          )}
        </div>

        {/* Search results */}
        {searching && (
          <EmptyState>Searching YouTube…</EmptyState>
        )}
        {!searching && visibleResults !== null && visibleResults.length === 0 && (
          <EmptyState>
            {results && results.length > 0
              ? 'All matching channels are already in your list.'
              : `No channels found for "${query.trim()}". Try a channel URL or @handle.`}
          </EmptyState>
        )}
        {!searching && visibleResults && visibleResults.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Results
            </div>
            {visibleResults.map((result) => (
              <ResultCard
                key={result.npub}
                result={result}
                kidName={kid.displayName}
                onAdd={() => handleAdd(result)}
              />
            ))}
          </div>
        )}

        {/* Active channels */}
        <ActiveSection
          channels={active}
          syncingNpubs={syncingNpubs}
          onToggle={(npub) => handleSetEnabled(npub, false)}
          disabled={isPending}
        />

        {/* Removed / available to re-add */}
        <RemovedSection
          channels={removed}
          onReenable={(npub) => handleSetEnabled(npub, true)}
          onForget={handleForget}
          disabled={isPending}
        />
      </div>
    </main>
  );
}

// ─── Result card ──────────────────────────────────────────────────────────────

function ResultCard({
  result,
  kidName,
  onAdd,
}: {
  result: SearchResult;
  kidName: string;
  onAdd: () => void;
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-card">
      <Avatar className="size-9 shrink-0 border border-border/70">
        <AvatarImage src={result.thumbnail} alt="" />
        <AvatarFallback>
          <MonitorPlay className="size-4 text-muted-foreground" />
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium leading-tight" title={result.title}>
          {result.title}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {result.watching ? 'Already watching' : 'Tap add to start watching'}
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        className="h-8 rounded-full px-3 text-[12px] shrink-0"
        onClick={onAdd}
        aria-label={`Add ${result.title} to ${kidName}'s feed`}
      >
        <Plus className="size-4 mr-1" aria-hidden />
        Add to {kidName}'s feed
      </Button>
    </div>
  );
}

// ─── Active section ─────────────────────────────────────────────────────────

function ActiveSection({
  channels,
  syncingNpubs,
  onToggle,
  disabled,
}: {
  channels: YouTubeChannelEntry[];
  syncingNpubs: Set<string>;
  onToggle: (npub: string) => void;
  disabled: boolean;
}) {
  if (channels.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <div className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Active
        </div>
        <EmptyState>No YouTube channels added yet. Search above to add one.</EmptyState>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Active · {channels.length}
      </div>
      <div className="flex flex-col gap-2">
        {channels.map((channel) => {
          const syncing = syncingNpubs.has(channel.npub);
          return (
            <div
              key={channel.npub}
              className="flex items-center gap-3 p-3 rounded-xl bg-card"
            >
              <ChannelAvatar picture={channel.picture} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium leading-tight" title={channel.title}>
                  {channel.title}
                </div>
                {syncing ? (
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" aria-hidden />
                    <span className="truncate">Fetching videos…</span>
                  </div>
                ) : (
                  <div className="truncate text-[11px] text-muted-foreground">Watching</div>
                )}
              </div>
              <Switch
                checked
                onCheckedChange={() => onToggle(channel.npub)}
                disabled={disabled}
                aria-label={`Disable ${channel.title}`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Removed / available-to-re-add section ────────────────────────────────────

function RemovedSection({
  channels,
  onReenable,
  onForget,
  disabled,
}: {
  channels: YouTubeChannelEntry[];
  onReenable: (npub: string) => void;
  onForget: (npub: string) => void;
  disabled: boolean;
}) {
  if (channels.length === 0) return null;
  return (
    <BrowseSectionShell title="Removed · available to re-add" count={channels.length}>
      <p className="px-1 pb-1 text-[11px] text-muted-foreground">
        These stay saved, so re-enabling is instant — no need to search again.
      </p>
      <div className="flex flex-col gap-2">
        {channels.map((channel) => (
          <div
            key={channel.npub}
            className="flex items-center gap-3 p-3 rounded-xl bg-card/60"
          >
            <ChannelAvatar picture={channel.picture} muted />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium leading-tight text-muted-foreground" title={channel.title}>
                {channel.title}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">Disabled</div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-8 rounded-full px-3 text-[12px]"
                onClick={() => onReenable(channel.npub)}
                disabled={disabled}
                aria-label={`Re-enable ${channel.title}`}
              >
                <RotateCcw className="size-3.5 mr-1" aria-hidden />
                Re-enable
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-8 rounded-full text-muted-foreground hover:text-destructive"
                onClick={() => onForget(channel.npub)}
                disabled={disabled}
                aria-label={`Forget ${channel.title}`}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </BrowseSectionShell>
  );
}

// ─── Shared bits ──────────────────────────────────────────────────────────────

function ChannelAvatar({ picture, muted }: { picture?: string; muted?: boolean }) {
  return (
    <Avatar className={`size-9 shrink-0 border border-border/70${muted ? ' opacity-60' : ''}`}>
      <AvatarImage src={picture} alt="" />
      <AvatarFallback>
        <MonitorPlay className="size-4 text-muted-foreground" />
      </AvatarFallback>
    </Avatar>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-card p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
