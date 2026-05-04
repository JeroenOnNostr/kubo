import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { nip19 } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';

import { useAuthor } from '@/hooks/useAuthor';
import { useAddrEvent, useEvent } from '@/hooks/useEvent';
import { useComments } from '@/hooks/useComments';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useKuboFamily } from '@/hooks/useKuboFamily';
import { useKidLayoutOptions } from '@/contexts/KuboKidLayoutContext';
import { useProfileMedia } from '@/hooks/useProfileMedia';
import { parseImetaMap, type ImetaEntry } from '@/lib/imeta';
import { genUserName } from '@/lib/genUserName';
import { KuboKidBottomNav } from '@/components/KuboKidBottomNav';
import { VideoPlayer } from '@/components/VideoPlayer';
import { YouTubeEmbed } from '@/components/YouTubeEmbed';
import { extractYouTubeEmbedInfo } from '@/lib/linkEmbed';
import { isYouTubeUrl } from '@/lib/videoEvent';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDistanceToNowStrict } from 'date-fns';

/**
 * /kid/post/:id — kid-themed post detail.
 *
 * Reachable only when view-only mode is OFF (the kid feed's NoteCard short-circuits
 * navigation otherwise). Loads via Ditto's useEvent (or useAddrEvent for naddr).
 *
 * Deliberately minimal vs. parent PostDetailPage — no comments, replies, zaps,
 * reactions, or share. Just the post media, the post text, the creator (one tap
 * to /kid/profile/:npub), and a "More from this creator" rail that re-uses the
 * profile-media query.
 *
 * Repost handling: the URL carries the inner event id, so the creator row
 * resolves to the original author via useAuthor(event.pubkey) — never the
 * reposter. That's a property of the data flow, not a special case.
 *
 * Back-stack: nav(-1) on the back button so creator → profile → post → back
 * lands the kid back on the profile. Rail-tile post→post hops use replace so
 * back doesn't walk through every visited post.
 */
export function KidPostDetailPage() {
  const nav = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { user } = useCurrentUser();
  const { family } = useKuboFamily();

  useKidLayoutOptions({ scrollAware: true });

  const showBlobbiTab = !!(user && family?.kidSettings?.[user.pubkey]?.showBlobbiTab);

  // The :id segment can be a raw hex event id, a nevent1 / note1 (regular event),
  // or a naddr1 (addressable event). Decode once and pick the right loader hook.
  const decoded = useMemo(() => decodePostId(id), [id]);

  // Always call both hooks; only one will be enabled depending on what was decoded.
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

  const author = useAuthor(event?.pubkey);
  const meta = author.data?.metadata;
  const authorName = meta?.display_name || meta?.name || (event ? genUserName(event.pubkey) : '');
  const authorPicture = meta?.picture;
  const authorNpub = useMemo(
    () => (event ? nip19.npubEncode(event.pubkey) : ''),
    [event],
  );

  return (
    <div className="min-h-dvh pb-24 flex flex-col gap-4 pt-2">
      {/* Top bar — back chevron only. nav(-1) so creator → profile → back works. */}
      <div className="px-4">
        <button
          type="button"
          aria-label="Back"
          onClick={() => nav(-1)}
          className="size-10 rounded-full bg-white/15 hover:bg-white/20 text-white flex items-center justify-center active:scale-95 transition-transform"
        >
          <ChevronLeft className="size-5" />
        </button>
      </div>

      {!decoded ? (
        <CenteredMessage>That link doesn't look right.</CenteredMessage>
      ) : isLoading ? (
        <PostSkeleton />
      ) : !event ? (
        <CenteredMessage>Couldn't find this post.</CenteredMessage>
      ) : (
        <>
          <KidPostHero event={event} authorName={authorName} />
          {/* Body text only when the hero isn't already a video — the player's
              own UI carries the title there. */}
          {!isVideoKind(event.kind) && event.content.trim() && (
            <p className="px-5 text-[14px] text-white leading-relaxed whitespace-pre-wrap break-words">
              {event.content}
            </p>
          )}

          {/* Creator row — one tap to /kid/profile/:npub. No inline Follow pill;
              follow lives on the profile page. */}
          <button
            type="button"
            onClick={() => nav(`/kid/profile/${authorNpub}`)}
            className="mx-4 flex items-center gap-3 px-3 py-2 rounded-xl text-left bg-white/10 hover:bg-white/15 transition-colors active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            <div
              className="size-10 rounded-full flex-shrink-0 overflow-hidden flex items-center justify-center text-sm font-semibold text-white"
              style={{ backgroundColor: authorPicture ? 'transparent' : '#6366F1' }}
              aria-hidden
            >
              {authorPicture ? (
                <img src={authorPicture} alt="" className="size-full object-cover" />
              ) : (
                authorName[0]?.toUpperCase() || '?'
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-white truncate">{authorName}</div>
              <div className="text-[11px] text-white/60 truncate">View profile</div>
            </div>
          </button>

          <MoreFromCreatorRail
            pubkey={event.pubkey}
            currentEventId={event.id}
          />

          <KidComments event={event} />
        </>
      )}

      <KuboKidBottomNav showBlobbi={showBlobbiTab} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function KidPostHero({ event, authorName }: { event: NostrEvent; authorName: string }) {
  const imetaMap = useMemo(() => parseImetaMap(event.tags), [event.tags]);
  const firstImeta: ImetaEntry | undefined = imetaMap.values().next().value;

  if (isVideoKind(event.kind) && firstImeta?.url) {
    const titleTag = getTag(event.tags, 'title');
    const youtubeInfo = isYouTubeUrl(firstImeta.url) ? extractYouTubeEmbedInfo(firstImeta.url) : null;
    const youtubeId = youtubeInfo?.id ?? null;
    const youtubeAspect = event.kind === 22 || youtubeInfo?.isShort ? 'short' : 'video';
    return (
      <div className="px-4">
        {/* KUBO-081 pattern: outer wrapper supplies bg-black + rounded clip,
            VideoPlayer is told to drop its default top-margin and border so
            the letterbox stays clean against the deep-blue page background
            (no white hairline frame around vines / kind-22 video). */}
        <div data-kubo-video className="relative rounded-2xl overflow-hidden bg-black">
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
        {titleTag && (
          <p className="mt-3 text-[15px] font-semibold leading-snug text-white break-words">
            {titleTag}
          </p>
        )}
      </div>
    );
  }

  // Image media (kind 1 with imeta image, kind 1063, kind 20).
  const firstImage = pickImage(event, imetaMap);
  if (firstImage) {
    return (
      <div className="px-4">
        <img
          src={firstImage}
          alt=""
          className="w-full rounded-2xl bg-white/5"
          loading="lazy"
        />
      </div>
    );
  }

  // Pure text — no hero, the body block below carries the content. Render an
  // empty placeholder so the spacing matches.
  return null;
}

// ---------------------------------------------------------------------------
// More from this creator (horizontal rail)
// ---------------------------------------------------------------------------

function MoreFromCreatorRail({
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
      <section className="flex flex-col gap-2">
        <h2 className="px-4 text-[10px] uppercase tracking-[0.1em] text-white/60 font-semibold">
          More from this creator
        </h2>
        <div className="flex gap-2 overflow-x-auto no-scrollbar px-4 pb-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton
              key={i}
              className="flex-shrink-0 size-28 rounded-xl bg-white/10"
            />
          ))}
        </div>
      </section>
    );
  }

  if (items.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-4 text-[10px] uppercase tracking-[0.1em] text-white/60 font-semibold">
        More from this creator
      </h2>
      <div className="flex gap-2 overflow-x-auto no-scrollbar px-4 pb-2">
        {items.map((event) => (
          <RailTile
            key={event.id}
            event={event}
            onOpen={() => nav(`/kid/post/${event.id}`, { replace: true })}
          />
        ))}
      </div>
    </section>
  );
}

function RailTile({ event, onOpen }: { event: NostrEvent; onOpen: () => void }) {
  const imetaMap = useMemo(() => parseImetaMap(event.tags), [event.tags]);
  const firstImeta = imetaMap.values().next().value as ImetaEntry | undefined;
  const thumb = firstImeta?.thumbnail
    ?? (firstImeta && !isVideoMime(firstImeta.mime, firstImeta.url) ? firstImeta.url : undefined);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex-shrink-0 size-28 rounded-xl overflow-hidden bg-white/10 active:scale-[0.97] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      aria-label="Open post"
    >
      {thumb ? (
        <img
          src={thumb}
          alt=""
          loading="lazy"
          className="size-full object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <div className="size-full bg-gradient-to-br from-[#334155] to-[#1E293B]" aria-hidden />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Comments (read-only, top-level NIP-22 only)
// ---------------------------------------------------------------------------

function KidComments({ event }: { event: NostrEvent }) {
  const { data, isLoading } = useComments(event, 200);

  // Read-only kid surface: no reply composer, no nesting, no zaps. Just the
  // top-level NIP-22 (kind 1111/1244) comments — newest first, capped at 50
  // so a noisy thread doesn't wreck the page.
  const comments = useMemo(
    () => (data?.topLevelComments ?? []).slice(0, 50),
    [data?.topLevelComments],
  );

  if (isLoading && comments.length === 0) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="px-4 text-[10px] uppercase tracking-[0.1em] text-white/60 font-semibold">
          Comments
        </h2>
        <div className="flex flex-col gap-2 px-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl bg-white/10" />
          ))}
        </div>
      </section>
    );
  }

  if (comments.length === 0) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="px-4 text-[10px] uppercase tracking-[0.1em] text-white/60 font-semibold">
          Comments
        </h2>
        <p className="px-4 text-[12px] text-white/60">No comments yet.</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-4 text-[10px] uppercase tracking-[0.1em] text-white/60 font-semibold">
        Comments
      </h2>
      <div className="flex flex-col gap-2 px-4">
        {comments.map((c) => (
          <KidCommentRow key={c.id} comment={c} />
        ))}
      </div>
    </section>
  );
}

function KidCommentRow({ comment }: { comment: NostrEvent }) {
  const author = useAuthor(comment.pubkey);
  const meta = author.data?.metadata;
  const name = meta?.display_name || meta?.name || genUserName(comment.pubkey);
  const picture = meta?.picture;
  const when = useMemo(() => {
    try {
      return formatDistanceToNowStrict(new Date(comment.created_at * 1000), { addSuffix: true });
    } catch {
      return '';
    }
  }, [comment.created_at]);

  return (
    <div className="flex gap-3 p-3 rounded-xl bg-white/10">
      <div
        className="size-8 rounded-full flex-shrink-0 overflow-hidden flex items-center justify-center text-xs font-semibold text-white"
        style={{ backgroundColor: picture ? 'transparent' : '#6366F1' }}
        aria-hidden
      >
        {picture ? (
          <img src={picture} alt="" className="size-full object-cover" />
        ) : (
          name[0]?.toUpperCase() || '?'
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-[12px] font-semibold text-white truncate">{name}</span>
          {when && <span className="text-[10px] text-white/50 truncate">{when}</span>}
        </div>
        <p className="text-[13px] text-white/90 leading-snug whitespace-pre-wrap break-words mt-0.5">
          {comment.content}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading / empty states
// ---------------------------------------------------------------------------

function PostSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-4">
      <Skeleton className="aspect-video w-full rounded-2xl bg-white/10" />
      <Skeleton className="h-4 w-3/4 bg-white/10" />
      <Skeleton className="h-3 w-1/2 bg-white/10" />
      <Skeleton className="h-12 w-full rounded-xl bg-white/10 mt-2" />
    </div>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  const nav = useNavigate();
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 px-5 text-center">
      <p className="text-[14px] text-white/80">{children}</p>
      <button
        type="button"
        onClick={() => nav(-1)}
        className="mt-2 h-10 px-6 rounded-full text-[13px] font-semibold bg-white/10 text-white border border-white/20 active:scale-95 transition-transform"
      >
        Go back
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type DecodedPostId =
  | { kind: 'event'; eventId: string; relays?: string[]; author?: string }
  | { kind: 'addr'; coords: { kind: number; pubkey: string; identifier: string }; relays?: string[] };

function decodePostId(raw: string | undefined): DecodedPostId | undefined {
  if (!raw) return undefined;
  // Raw hex event id.
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

function isVideoKind(kind: number): boolean {
  return kind === 21 || kind === 22 || kind === 34236;
}

function isVideoMime(mime: string | undefined, url: string | undefined): boolean {
  if (mime?.startsWith('video/')) return true;
  if (url && /\.(mp4|webm|mov|m3u8)(\?|$)/i.test(url)) return true;
  return false;
}

function getTag(tags: string[][], name: string): string | undefined {
  return tags.find(([n]) => n === name)?.[1];
}

function pickImage(event: NostrEvent, imetaMap: Map<string, ImetaEntry>): string | undefined {
  for (const entry of imetaMap.values()) {
    if (!isVideoMime(entry.mime, entry.url)) {
      return entry.thumbnail ?? entry.url;
    }
  }
  if (event.kind === 1063) {
    const url = getTag(event.tags, 'url');
    if (url && !isVideoMime(getTag(event.tags, 'm'), url)) return url;
  }
  // Fall back to first image URL embedded in content.
  const m = event.content.match(/https?:\/\/\S+?\.(?:jpg|jpeg|png|webp|gif)(?:\?\S*)?/i);
  return m?.[0];
}
