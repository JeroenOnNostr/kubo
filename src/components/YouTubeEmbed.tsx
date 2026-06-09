import { useEffect, useRef, useState } from 'react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useKuboFamily } from '@/hooks/useKuboFamily';
import { cn } from '@/lib/utils';
import { findThumbnail } from '@/lib/youtubeThumbnail';

// Tracks the currently-active YouTubeEmbed across the app so that starting a
// new one preempts the previous (only one YouTube video plays at a time).
let activeDeactivate: (() => void) | null = null;

interface YouTubeEmbedProps {
  videoId: string;
  className?: string;
  /**
   * Frame aspect ratio. `'video'` (default) renders 16:9 for normal long-form
   * videos; `'short'` renders 9:16 for YouTube Shorts so they fill the card
   * in portrait instead of being letterboxed inside a horizontal box.
   */
  aspect?: 'video' | 'short';
}

/**
 * Renders a YouTube video embed with a privacy-respecting click-to-load facade.
 *
 * Shows a thumbnail and play button instead of mounting the iframe immediately,
 * so no requests are made to YouTube until the user explicitly clicks play.
 *
 * Probes thumbnail sizes off-screen before rendering so the gray placeholder
 * is never visible to the user.
 */
export function YouTubeEmbed({ videoId, className, aspect = 'video' }: YouTubeEmbedProps) {
  const [activated, setActivated] = useState(false);
  const [resolvedThumb, setResolvedThumb] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Kid-mode detection mirrors useActionVisibility / useKuboTeppFeedFilter:
  // active signer matches one of the family's kid pubkeys.
  const { user } = useCurrentUser();
  const { family } = useKuboFamily();
  const isKidMode =
    !!user?.pubkey && !!family?.kids.some((k) => k.pubkey === user.pubkey);

  useEffect(() => {
    let cancelled = false;
    setResolvedThumb(null);

    findThumbnail(videoId).then((url) => {
      if (!cancelled) setResolvedThumb(url);
    });

    return () => { cancelled = true; };
  }, [videoId]);

  // While activated: preempt any other playing YouTube embed, and pause this
  // one (by tearing the iframe back down to the thumbnail facade) when it
  // scrolls out of view. Threshold matches usePlayerControls for native videos.
  useEffect(() => {
    if (!activated) return;

    const deactivate = () => setActivated(false);

    if (activeDeactivate && activeDeactivate !== deactivate) {
      activeDeactivate();
    }
    activeDeactivate = deactivate;

    const wrapper = wrapperRef.current;
    let observer: IntersectionObserver | undefined;
    if (wrapper) {
      observer = new IntersectionObserver(
        ([entry]) => { if (!entry.isIntersecting) deactivate(); },
        { threshold: 0.25 },
      );
      observer.observe(wrapper);
    }

    return () => {
      observer?.disconnect();
      if (activeDeactivate === deactivate) activeDeactivate = null;
    };
  }, [activated]);

  return (
    <div
      ref={wrapperRef}
      className={cn('rounded-xl overflow-hidden', className)}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="relative w-full"
        style={{ aspectRatio: aspect === 'short' ? '9 / 16' : '16 / 9' }}
      >
        {activated ? (
          <>
            {/* controls=0 hides YouTube's native control bar. It's a documented
                player param (NOT a player modification), and the player's own
                branding logic keeps the bottom-right wordmark. We need it because
                the tile player is well below YouTube's ~480x270 minimum (it's
                ~388x218 on a phone), and below that floor YouTube does NOT shrink
                its control chrome — so play/pause/CC/fullscreen/seek render huge
                and obstruct the video. We can't restyle them: the iframe is
                cross-origin (youtube-nocookie.com). Tap-to-play/pause still works
                with controls hidden. Do NOT remove this without re-checking the
                small-frame chrome (KUBO-141). */}
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&enablejsapi=1&controls=0`}
              title="YouTube video"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              sandbox="allow-scripts allow-same-origin allow-presentation"
              className="absolute inset-0 w-full h-full -mb-px -mr-px"
            />
            {/* Kid-mode click-eaters covering YouTube's player UI tap targets
                that would let the kid escape the parent-approved video:
                the share / chain-icon button and the "More videos" pill on
                the lower-left, and the YouTube wordmark on the lower-right.
                Same defense layer as the existing Android nav guard, just
                client-side for the actions that don't go through navigation
                (clipboard write, in-iframe video swap).
                Positioned above the red seek bar so play/pause (centre) and
                the fullscreen toggle (bottom-right corner) stay tappable.
                Transparent + cursor-default so the masks don't read as broken
                UI. Only painted when the iframe is mounted (activated). */}
            {isKidMode && (
              <>
                <div
                  className="absolute left-0 right-[35%] bottom-[12%] h-12 z-10 cursor-default"
                  onClick={(e) => e.stopPropagation()}
                  aria-hidden
                />
                <div
                  className="absolute right-0 w-[30%] bottom-[12%] h-12 z-10 cursor-default"
                  onClick={(e) => e.stopPropagation()}
                  aria-hidden
                />
              </>
            )}
          </>
        ) : (
          <button
            type="button"
            className="block w-full h-full cursor-pointer bg-black group"
            onClick={() => setActivated(true)}
            aria-label="Play video"
          >
            {resolvedThumb && (
              <img
                src={resolvedThumb}
                alt=""
                className="absolute inset-0 w-full h-full object-cover"
              />
            )}

            {/* Play button — mimics the YouTube red pill shape */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div
                className={cn(
                  'flex items-center justify-center',
                  'w-[68px] h-[48px] rounded-xl',
                  'bg-[#212121]/80 group-hover:bg-[#ff0000] transition-colors duration-200',
                )}
              >
                {/* Play triangle */}
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-white ml-0.5">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            </div>
          </button>
        )}
      </div>
    </div>
  );
}
