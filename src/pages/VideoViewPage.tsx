import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Share2 } from 'lucide-react';
import { nip19 } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useEvent, useAddrEvent } from '@/hooks/useEvent';
import { useAuthor } from '@/hooks/useAuthor';
import { useProfileMedia } from '@/hooks/useProfileMedia';
import { VideoPlayer } from '@/components/VideoPlayer';
import { YouTubeEmbed } from '@/components/YouTubeEmbed';
import { parseImetaMap, type ImetaEntry } from '@/lib/imeta';
import { extractYouTubeEmbedInfo } from '@/lib/linkEmbed';
import { isYouTubeUrl } from '@/lib/videoEvent';
import { genUserName } from '@/lib/genUserName';

/**
 * /parent/video/:id — single video view (parent surface).
 *
 * Mirrors KidPostDetailPage's data flow but keeps the parent visual shell
 * (light theme, share button, "Following" pill, "More like this" rail).
 *
 * Reachable from: parent watch-history strip on /parent/home, full history
 * /parent/watch-history, and the parent profile's Videos tab. The :id is
 * raw hex by convention (watch entries store hex), but the decoder also
 * accepts note1 / nevent1 / naddr1 in case a share link is opened directly.
 *
 * Mirrors the kid post-detail layout (KidPostDetailPage): bento creator row
 * with name + "View profile" subtitle and no inline Follow button — follow
 * lives on the profile page.
 */
export function VideoViewPage() {
  const nav = useNavigate();
  const { id } = useParams<{ id: string }>();

  const decoded = useMemo(() => decodePostId(id), [id]);

  const eventQuery = useEvent(
    decoded?.kind === 'event' ? decoded.eventId : undefined,
    decoded?.kind === 'event' ? decoded.relays : undefined,
    decoded?.kind === 'event' ? decoded.author : undefined,
  );
  const addrQuery = useAddrEvent(
    decoded?.kind === 'addr' ? decoded.coords : undefined,
    decoded?.kind === 'addr' ? decoded.relays : undefined,
  );

  const event: NostrEvent | null | undefined =
    decoded?.kind === 'addr' ? addrQuery.data : eventQuery.data;
  const isLoading =
    decoded?.kind === 'addr' ? addrQuery.isLoading : eventQuery.isLoading;
  const refetch = decoded?.kind === 'addr' ? addrQuery.refetch : eventQuery.refetch;

  return (
    <div className="flex flex-col gap-3 pt-2 pb-6">
      <TopBar onBack={() => nav(-1)} />

      {!decoded ? (
        <CenteredMessage
          title="That link doesn't look right."
          onBack={() => nav(-1)}
        />
      ) : isLoading ? (
        <PageSkeleton />
      ) : !event ? (
        <CenteredMessage
          title="Couldn't load this video."
          subtitle="The post may no longer be available."
          onRetry={() => void refetch()}
          onBack={() => nav(-1)}
        />
      ) : (
        <Loaded event={event} />
      )}
    </div>
  );
}

function TopBar({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex items-center gap-2 px-4">
      <Button
        variant="ghost"
        size="icon"
        className="size-9 rounded-full"
        onClick={onBack}
        aria-label="Back"
      >
        <ChevronLeft className="size-5" />
      </Button>
      <div className="flex-1" />
      <Button
        variant="ghost"
        size="icon"
        className="size-9 rounded-full"
        aria-label="Share"
      >
        <Share2 className="size-5" />
      </Button>
    </div>
  );
}

function Loaded({ event }: { event: NostrEvent }) {
  const nav = useNavigate();
  const author = useAuthor(event.pubkey);
  const meta = author.data?.metadata;
  const authorName = meta?.display_name || meta?.name || genUserName(event.pubkey);
  const authorPicture = meta?.picture;
  const authorNpub = useMemo(() => nip19.npubEncode(event.pubkey), [event.pubkey]);

  const imetaMap = useMemo(() => parseImetaMap(event.tags), [event.tags]);
  const firstImeta: ImetaEntry | undefined = imetaMap.values().next().value;
  const titleTag = getTag(event.tags, 'title');
  const title = titleTag || event.content.split('\n')[0]?.trim() || 'Untitled video';

  return (
    <>
      <Player event={event} firstImeta={firstImeta} authorName={authorName} titleTag={titleTag} />

      <h1 className="px-4 text-[15px] font-semibold leading-snug text-balance">
        {title}
      </h1>

      <button
        type="button"
        onClick={() => nav(`/parent/profile/${authorNpub}`)}
        className="mx-4 flex items-center gap-3 px-3 py-2 rounded-xl text-left bg-card hover:bg-card/80 transition-colors active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <Avatar picture={authorPicture} name={authorName} />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold truncate">{authorName}</div>
          <div className="text-[11px] text-muted-foreground truncate">View profile</div>
        </div>
      </button>

      <MoreLikeThisRail pubkey={event.pubkey} currentEventId={event.id} />
    </>
  );
}

function Player({
  event,
  firstImeta,
  authorName,
  titleTag,
}: {
  event: NostrEvent;
  firstImeta: ImetaEntry | undefined;
  authorName: string;
  titleTag: string | undefined;
}) {
  if (!firstImeta?.url) {
    return (
      <div
        className="mx-4 aspect-video rounded-2xl bg-muted"
        aria-hidden
      />
    );
  }

  const youtubeInfo = isYouTubeUrl(firstImeta.url)
    ? extractYouTubeEmbedInfo(firstImeta.url)
    : null;
  const youtubeId = youtubeInfo?.id ?? null;
  const youtubeAspect = event.kind === 22 || youtubeInfo?.isShort ? 'short' : 'video';

  return (
    <div className="mx-4 rounded-2xl overflow-hidden bg-black">
      {youtubeId ? (
        <YouTubeEmbed videoId={youtubeId} aspect={youtubeAspect} className="rounded-2xl" />
      ) : (
        <VideoPlayer
          src={firstImeta.url}
          poster={firstImeta.thumbnail}
          dim={firstImeta.dim}
          blurhash={firstImeta.blurhash}
          title={titleTag ?? undefined}
          artist={authorName}
          className="mt-0 rounded-2xl border-0"
        />
      )}
    </div>
  );
}

function MoreLikeThisRail({
  pubkey,
  currentEventId,
}: {
  pubkey: string;
  currentEventId: string;
}) {
  const nav = useNavigate();
  const { data, isLoading } = useProfileMedia(pubkey);

  const items = useMemo(() => {
    const all = data?.pages.flatMap((p) => p.events) ?? [];
    return all.filter((e) => e.id !== currentEventId).slice(0, 12);
  }, [data?.pages, currentEventId]);

  if (isLoading && items.length === 0) {
    return (
      <section className="flex flex-col gap-2 mt-2">
        <h2 className="px-4 text-[10px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">
          More like this
        </h2>
        <div className="flex gap-3 overflow-x-auto no-scrollbar px-4 pb-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton
              key={i}
              className="flex-shrink-0 w-44 aspect-video rounded-xl bg-muted"
            />
          ))}
        </div>
      </section>
    );
  }

  if (items.length === 0) return null;

  return (
    <section className="flex flex-col gap-2 mt-2">
      <h2 className="px-4 text-[10px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">
        More like this
      </h2>
      <div className="flex gap-3 overflow-x-auto no-scrollbar px-4 pb-2">
        {items.map((item) => (
          <RailTile
            key={item.id}
            event={item}
            onOpen={() => nav(`/parent/video/${item.id}`, { replace: true })}
          />
        ))}
      </div>
    </section>
  );
}

function RailTile({ event, onOpen }: { event: NostrEvent; onOpen: () => void }) {
  const imetaMap = useMemo(() => parseImetaMap(event.tags), [event.tags]);
  const firstImeta = imetaMap.values().next().value as ImetaEntry | undefined;
  const thumb =
    firstImeta?.thumbnail ??
    (firstImeta && !isVideoMime(firstImeta.mime, firstImeta.url) ? firstImeta.url : undefined);
  const title = getTag(event.tags, 'title') || event.content.split('\n')[0]?.trim() || '';

  const [broken, setBroken] = useState(false);
  const showImage = !!thumb && !broken;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex-shrink-0 w-44 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-xl"
      aria-label={title || 'Open video'}
    >
      <div
        className="aspect-video w-full rounded-xl mb-2 overflow-hidden"
        style={
          showImage
            ? undefined
            : { background: 'linear-gradient(135deg, #334155, #1E293B)' }
        }
      >
        {showImage && (
          <img
            src={thumb}
            alt=""
            loading="lazy"
            className="size-full object-cover"
            onError={() => setBroken(true)}
          />
        )}
      </div>
      {title && (
        <div className="text-[12px] font-medium line-clamp-2">{title}</div>
      )}
    </button>
  );
}

function Avatar({ picture, name }: { picture: string | undefined; name: string }) {
  const [broken, setBroken] = useState(false);
  const showImage = !!picture && !broken;
  return (
    <div
      className="size-10 rounded-full flex-shrink-0 overflow-hidden flex items-center justify-center text-white text-sm font-semibold"
      style={{ backgroundColor: showImage ? 'transparent' : '#6366F1' }}
      aria-hidden
    >
      {showImage ? (
        <img
          src={picture}
          alt=""
          className="size-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
        />
      ) : (
        name[0]?.toUpperCase() || '?'
      )}
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="mx-4 aspect-video rounded-2xl bg-muted" />
      <Skeleton className="mx-4 h-5 w-3/4 bg-muted" />
      <div className="mx-4 flex items-center gap-3 mt-1">
        <Skeleton className="size-10 rounded-full bg-muted" />
        <Skeleton className="h-3 w-32 bg-muted" />
      </div>
      <Skeleton className="mx-4 h-12 w-full rounded-xl bg-muted mt-1" />
    </div>
  );
}

function CenteredMessage({
  title,
  subtitle,
  onRetry,
  onBack,
}: {
  title: string;
  subtitle?: string;
  onRetry?: () => void;
  onBack: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 px-5 py-12 text-center">
      <p className="text-[14px] font-medium">{title}</p>
      {subtitle && (
        <p className="text-[12px] text-muted-foreground">{subtitle}</p>
      )}
      <div className="flex gap-2 mt-3">
        {onRetry && (
          <Button
            type="button"
            variant="default"
            className="rounded-full"
            onClick={onRetry}
          >
            Try again
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          className="rounded-full"
          onClick={onBack}
        >
          Go back
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type DecodedPostId =
  | { kind: 'event'; eventId: string; relays?: string[]; author?: string }
  | {
      kind: 'addr';
      coords: { kind: number; pubkey: string; identifier: string };
      relays?: string[];
    };

function decodePostId(raw: string | undefined): DecodedPostId | undefined {
  if (!raw) return undefined;
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    return { kind: 'event', eventId: raw.toLowerCase() };
  }
  try {
    const d = nip19.decode(raw);
    if (d.type === 'note') return { kind: 'event', eventId: d.data };
    if (d.type === 'nevent') {
      return {
        kind: 'event',
        eventId: d.data.id,
        relays: d.data.relays,
        author: d.data.author,
      };
    }
    if (d.type === 'naddr') {
      return {
        kind: 'addr',
        coords: {
          kind: d.data.kind,
          pubkey: d.data.pubkey,
          identifier: d.data.identifier,
        },
        relays: d.data.relays,
      };
    }
  } catch {
    // fall through
  }
  return undefined;
}

function isVideoMime(mime: string | undefined, url: string | undefined): boolean {
  if (mime?.startsWith('video/')) return true;
  if (url && /\.(mp4|webm|mov|m3u8)(\?|$)/i.test(url)) return true;
  return false;
}

function getTag(tags: string[][], name: string): string | undefined {
  return tags.find(([n]) => n === name)?.[1];
}
