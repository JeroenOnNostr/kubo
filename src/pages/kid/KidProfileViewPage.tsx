import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Copy, Play } from 'lucide-react';
import { nip19 } from 'nostr-tools';
import type { NostrEvent, NostrMetadata } from '@nostrify/nostrify';

import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { getKidSettings } from '@/hooks/useKuboFamily';
import { useKidLayoutOptions } from '@/contexts/KuboKidLayoutContext';
import { useNip85UserStats } from '@/hooks/useNip85Stats';
import { useProfileMedia } from '@/hooks/useProfileMedia';
import { useToast } from '@/hooks/useToast';
import { useKuboFamily } from '@/hooks/useKuboFamily';
import { FollowButton } from '@/components/FollowButton';
import { AssignTrustLevelButton } from '@/components/trust/AssignTrustLevelButton';
import { KuboKidBottomNav } from '@/components/KuboKidBottomNav';
import { genUserName } from '@/lib/genUserName';
import { cn } from '@/lib/utils';

/**
 * /kid/profile/:npub — kid-themed profile viewer.
 *
 * Visual sibling of /parent/profile/:npub (ProfileViewPage), reskinned for the
 * deep-blue KuboKidLayout. Same Nostr data sources (useAuthor, useNip85UserStats,
 * useProfileMedia) — only the surrounding chrome changes.
 *
 * Always reachable on a profile-photo tap, regardless of view-only mode. The
 * Videos-grid tile click is what's gated: when view-only is ON the tiles are
 * non-clickable; when OFF they route to /kid/post/:id.
 */
export function KidProfileViewPage() {
  const nav = useNavigate();
  const { npub } = useParams<{ npub: string }>();
  const { user } = useCurrentUser();
  const { family } = useKuboFamily();

  // Hide top-bar on scroll, like /kid home.
  useKidLayoutOptions({ scrollAware: true });

  const pubkey = useMemo(() => {
    if (!npub) return undefined;
    try {
      const decoded = nip19.decode(npub);
      return decoded.type === 'npub' ? decoded.data : undefined;
    } catch {
      return /^[0-9a-f]{64}$/i.test(npub) ? npub.toLowerCase() : undefined;
    }
  }, [npub]);

  const { data: author } = useAuthor(pubkey);
  const { data: stats } = useNip85UserStats(pubkey);
  const metadata = author?.metadata;

  const isViewOnly = !!user?.pubkey
    && getKidSettings(user.pubkey).viewOnly === true;
  const showBlobbiTab = !!(user && family?.kidSettings?.[user.pubkey]?.showBlobbiTab);

  const displayName = metadata?.display_name
    || metadata?.name
    || (pubkey ? genUserName(pubkey) : '');
  const handle = useMemo(() => {
    if (metadata?.nip05) {
      return metadata.nip05.startsWith('_@')
        ? metadata.nip05.slice(2)
        : metadata.nip05;
    }
    if (metadata?.name) return `@${metadata.name}`;
    if (pubkey) {
      const encoded = nip19.npubEncode(pubkey);
      return `${encoded.slice(0, 12)}…${encoded.slice(-4)}`;
    }
    return '';
  }, [metadata?.nip05, metadata?.name, pubkey]);
  const bio = metadata?.about ?? '';
  const picture = metadata?.picture;
  const banner = metadata?.banner;
  const followers = stats?.followers;

  const [tab, setTab] = useState<'videos' | 'about'>('videos');

  if (!pubkey) {
    return (
      <div className="min-h-dvh pb-24 flex flex-col items-center justify-center gap-2 px-5 text-center">
        <div className="text-lg font-semibold">Profile not found</div>
        <p className="text-[12px] text-white/70">
          That link doesn't look right.
        </p>
        <button
          type="button"
          onClick={() => nav(-1)}
          className="mt-2 h-10 px-6 rounded-full text-[13px] font-semibold bg-white/10 text-white border border-white/20 active:scale-95 transition-transform"
        >
          Go back
        </button>
        <KuboKidBottomNav showBlobbi={showBlobbiTab} />
      </div>
    );
  }

  return (
    <div className="min-h-dvh pb-24 flex flex-col gap-3 pt-0">
      {/* Banner */}
      <div
        className="relative h-32 mx-4 rounded-2xl mt-2 overflow-hidden"
        style={banner
          ? { backgroundImage: `url(${banner})`, backgroundSize: 'cover', backgroundPosition: 'center' }
          : { background: 'linear-gradient(135deg, #F97316, #EA580C)' }}
      >
        <button
          type="button"
          aria-label="Back"
          onClick={() => nav(-1)}
          className="absolute left-2 top-2 size-9 rounded-full bg-black/30 hover:bg-black/40 text-white flex items-center justify-center active:scale-95 transition-transform"
        >
          <ChevronLeft className="size-5" />
        </button>
      </div>

      {/* Avatar + name */}
      <div className="relative px-5 -mt-10 flex items-end gap-3">
        <div
          className="size-20 rounded-full border-4 flex-shrink-0 overflow-hidden flex items-center justify-center text-2xl font-semibold text-white"
          style={{
            backgroundColor: picture ? 'transparent' : '#6366F1',
            borderColor: '#1E3A8A',
          }}
          aria-hidden
        >
          {picture ? (
            <img src={picture} alt="" className="size-full object-cover" />
          ) : (
            displayName[0]?.toUpperCase() || '?'
          )}
        </div>
        <div className="flex-1 min-w-0 pb-1">
          <div className="text-lg font-semibold leading-tight truncate text-white">{displayName}</div>
          <div className="text-[12px] text-white/70 truncate">
            {handle}
            {typeof followers === 'number' && followers > 0 && (
              <> · {formatCount(followers)}</>
            )}
          </div>
        </div>
      </div>

      {/* Actions — Follow (orange primary) + Assign trust (ghost). FollowButton hides itself
          on own-profile / logged-out; AssignTrustLevelButton hides without a selected kid. */}
      <div className="px-4 flex gap-2 mt-1">
        <FollowButton
          pubkey={pubkey}
          size="default"
          className="flex-1 h-10 bg-[#F97316] text-white border-0 hover:bg-[#EA580C] data-[following=true]:bg-transparent"
        />
        <AssignTrustLevelButton
          pubkey={pubkey}
          size="default"
          className="flex-1 h-10 bg-transparent border border-white/30 text-white hover:bg-white/10"
        />
      </div>

      {/* Bio */}
      {bio && (
        <p className="px-5 text-[12px] text-white/70 leading-relaxed whitespace-pre-wrap">
          {bio}
        </p>
      )}

      {/* Tabs */}
      <div className="px-4 flex items-center gap-2 mt-1" role="tablist">
        <KidTabButton active={tab === 'videos'} onClick={() => setTab('videos')}>
          Videos
        </KidTabButton>
        <KidTabButton active={tab === 'about'} onClick={() => setTab('about')}>
          About
        </KidTabButton>
      </div>

      {/* Tab content */}
      {tab === 'videos' ? (
        <KidVideosTab
          pubkey={pubkey}
          onOpen={isViewOnly ? undefined : (id) => nav(`/kid/post/${id}`)}
        />
      ) : (
        <KidAboutTab metadata={metadata} pubkey={pubkey} />
      )}

      <KuboKidBottomNav showBlobbi={showBlobbiTab} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Videos tab
// ---------------------------------------------------------------------------

const SKELETON_GRADIENTS = [
  'linear-gradient(135deg, #334155, #1E293B)',
  'linear-gradient(135deg, #475569, #1E293B)',
  'linear-gradient(135deg, #0891B2, #164E63)',
  'linear-gradient(135deg, #7C3AED, #4C1D95)',
  'linear-gradient(135deg, #F97316, #9A3412)',
  'linear-gradient(135deg, #22C55E, #166534)',
];

function KidVideosTab({
  pubkey,
  onOpen,
}: {
  pubkey: string;
  /** Undefined = view-only mode, tiles render but don't navigate. */
  onOpen?: (id: string) => void;
}) {
  const { data, isLoading, isError } = useProfileMedia(pubkey);

  if (isLoading) {
    return (
      <div className="px-4 grid grid-cols-3 gap-2">
        {SKELETON_GRADIENTS.map((grad, i) => (
          <div
            key={i}
            className="aspect-square rounded-lg animate-pulse"
            style={{ background: grad }}
            aria-hidden
          />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="px-5 pt-6 text-center text-[12px] text-white/70">
        Couldn't load videos.
      </div>
    );
  }

  const events = data?.pages.flatMap((p) => p.events) ?? [];
  if (events.length === 0) {
    return (
      <div className="px-5 pt-6 text-center text-[12px] text-white/70">
        No videos yet.
      </div>
    );
  }

  return (
    <div className="px-4 grid grid-cols-3 gap-2">
      {events.map((event, i) => (
        <KidProfileMediaTile
          key={event.id}
          event={event}
          fallbackGradient={SKELETON_GRADIENTS[i % SKELETON_GRADIENTS.length]}
          onClick={onOpen ? () => onOpen(event.id) : undefined}
        />
      ))}
    </div>
  );
}

function KidProfileMediaTile({
  event,
  fallbackGradient,
  onClick,
}: {
  event: NostrEvent;
  fallbackGradient: string;
  onClick?: () => void;
}) {
  const { thumb, isVideo } = useMemo(() => deriveThumbnail(event), [event]);

  const inner = (
    <>
      {thumb && (
        <img
          src={thumb}
          alt=""
          loading="lazy"
          className="size-full object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      )}
      {isVideo && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
          <Play className="size-6 text-white drop-shadow-md" />
        </div>
      )}
    </>
  );

  // View-only mode: render as a plain div (no button affordance, no pointer
  // cursor, not focusable) so taps are visibly inert.
  if (!onClick) {
    return (
      <div
        className="relative aspect-square rounded-lg overflow-hidden"
        style={!thumb ? { background: fallbackGradient } : undefined}
        aria-hidden
      >
        {inner}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="relative aspect-square rounded-lg overflow-hidden"
      style={!thumb ? { background: fallbackGradient } : undefined}
      aria-label="Open video"
    >
      {inner}
    </button>
  );
}

/**
 * Lifted from ProfileViewPage. Extract a thumbnail URL from a Nostr event's
 * NIP-92 imeta, NIP-94 url tag, or embedded URL in content. Returns whether
 * the primary media is a video so we can overlay a play icon.
 */
function deriveThumbnail(event: NostrEvent): { thumb?: string; isVideo: boolean } {
  let imetaImage: string | undefined;
  let imetaUrl: string | undefined;
  let imetaVideoUrl: string | undefined;

  for (const tag of event.tags) {
    if (tag[0] === 'imeta') {
      for (const part of tag.slice(1)) {
        const [k, ...rest] = part.split(' ');
        const v = rest.join(' ');
        if (k === 'image' && !imetaImage) imetaImage = v;
        if (k === 'url' && !imetaUrl) imetaUrl = v;
      }
      if (imetaUrl && isVideoUrl(imetaUrl) && !imetaVideoUrl) {
        imetaVideoUrl = imetaUrl;
      }
    }
    if (tag[0] === 'url' && !imetaUrl) imetaUrl = tag[1];
    if (tag[0] === 'thumb' && !imetaImage) imetaImage = tag[1];
    if (tag[0] === 'image' && !imetaImage) imetaImage = tag[1];
  }

  if (imetaImage) return { thumb: imetaImage, isVideo: !!imetaVideoUrl };
  if (imetaUrl && !isVideoUrl(imetaUrl)) return { thumb: imetaUrl, isVideo: false };
  if (imetaVideoUrl) return { thumb: undefined, isVideo: true };

  const contentMatch = event.content.match(
    /https?:\/\/\S+?\.(?:jpg|jpeg|png|webp|gif|mp4|webm|mov)(?:\?\S*)?/i,
  );
  if (contentMatch) {
    const url = contentMatch[0];
    if (isVideoUrl(url)) return { thumb: undefined, isVideo: true };
    return { thumb: url, isVideo: false };
  }

  return { thumb: undefined, isVideo: false };
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov)(\?|$)/i.test(url);
}

// ---------------------------------------------------------------------------
// About tab
// ---------------------------------------------------------------------------

function KidAboutTab({
  metadata,
  pubkey,
}: {
  metadata: NostrMetadata | undefined;
  pubkey: string;
}) {
  const { toast } = useToast();
  const npub = useMemo(() => nip19.npubEncode(pubkey), [pubkey]);

  const about = metadata?.about?.trim();
  const website = metadata?.website?.trim();
  const lud16 = metadata?.lud16?.trim();
  const nip05 = metadata?.nip05?.trim();

  const copyNpub = async () => {
    try {
      await navigator.clipboard.writeText(npub);
      toast({ title: 'Copied npub' });
    } catch {
      toast({ title: 'Copy failed', variant: 'destructive' });
    }
  };

  return (
    <div className="px-5 flex flex-col gap-3 text-[13px] leading-relaxed text-white">
      {about && <KidFact label="Bio" value={about} multiline />}
      {website && (
        <KidFact
          label="Website"
          value={
            <a
              href={normalizeUrl(website)}
              target="_blank"
              rel="noreferrer noopener"
              className="text-[#FDBA74] underline-offset-2 hover:underline break-all"
            >
              {website}
            </a>
          }
        />
      )}
      {lud16 && <KidFact label="Lightning" value={<span className="break-all">{lud16}</span>} />}
      {nip05 && <KidFact label="NIP-05" value={<span className="break-all">{nip05}</span>} />}
      <KidFact
        label="npub"
        value={
          <button
            type="button"
            onClick={copyNpub}
            className="inline-flex items-center gap-1.5 text-left break-all hover:text-[#FDBA74] transition-colors"
          >
            <span className="font-mono text-[11px]">{npub.slice(0, 24)}…</span>
            <Copy className="size-3.5 flex-shrink-0" aria-hidden />
          </button>
        }
      />
    </div>
  );
}

function normalizeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

// ---------------------------------------------------------------------------
// Small UI helpers (kid-themed)
// ---------------------------------------------------------------------------

function KidTabButton({
  active, onClick, children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'h-8 px-4 rounded-full text-[12px] font-semibold transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40',
        active
          ? 'bg-[#F97316] text-white'
          : 'bg-white/10 text-white/70 hover:text-white',
      )}
    >
      {children}
    </button>
  );
}

function KidFact({
  label,
  value,
  multiline,
}: {
  label: string;
  value: React.ReactNode;
  multiline?: boolean;
}) {
  if (multiline) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.08em] text-white/60 font-semibold">
          {label}
        </span>
        <span className="whitespace-pre-wrap">{value}</span>
      </div>
    );
  }
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-[11px] uppercase tracking-[0.08em] text-white/60 font-semibold">
        {label}
      </span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
}
