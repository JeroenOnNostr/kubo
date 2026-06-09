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
            {/* Scale trick (KUBO-142): the SAME ~480x270 floor that bloats the
                control bar also bloats the title bar, the YouTube/"Watch on"
                wordmark, and the channel-avatar chip — controls=0 hides the bar
                but leaves those, rendered at their fixed minimum px size, huge
                relative to the ~353px on-screen frame. We can't size them via
                CSS/DOM (cross-origin) and no URL param controls them
                (showinfo/modestbranding are dead). So we render the iframe at 2x
                the box (w/h-[200%]) — making YouTube think it's a ~706px player,
                ABOVE the floor, so it lays out small/proportional chrome — then
                scale-50 from the top-left corner shrinks the whole player (video
                AND chrome together) back to exactly fill the inset-0 box. Net
                rendered size = 200% * 0.5 = 100%, same framing as before, but the
                chrome is now proportional. Higher internal res may bump YouTube's
                quality tier slightly; transform is GPU-composited so ~free.
                If chrome is still a touch large, raise both the 200% and the
                inverse scale together (e.g. 250% + scale of 0.4). */}
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&enablejsapi=1&controls=0`}
              title="YouTube video"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              sandbox="allow-scripts allow-same-origin allow-presentation"
              className="absolute top-0 left-0 w-[200%] h-[200%] origin-top-left scale-50 -mb-px -mr-px"
            />
            {/* Kid-mode click-eaters covering YouTube's player UI tap targets
                that would let the kid escape the parent-approved video:
                the share / chain-icon button (bottom-left), the "More videos"
                button (bottom-centre), and the YouTube wordmark (bottom-right),
                which all surface on tap/pause along the bottom row of the
                player. Same defense layer as the existing Android nav guard,
                just client-side for the actions that don't go through
                navigation (clipboard write, in-iframe video swap).

                After the KUBO-142 scale trick the chrome lays out across the
                full bottom band (see screenshot in KUBO-143), so the masks are
                percentage-based to track it. We mask the whole bottom ~28% of
                the frame EXCEPT the extreme bottom-right corner, which stays
                open for the fullscreen toggle. The centre play/pause button
                sits at ~50% height, well above this band, so it stays tappable.
                Transparent + cursor-default so the masks don't read as broken
                UI. Only painted when the iframe is mounted (activated). */}
            {isKidMode && (
              <>
                {/* Bottom band minus the bottom-right fullscreen corner: covers
                    chain icon, "More videos", and the wordmark. */}
                <div
                  className="absolute left-0 right-[18%] bottom-0 h-[28%] z-10 cursor-default"
                  onClick={(e) => e.stopPropagation()}
                  aria-hidden
                />
                {/* Right edge above the fullscreen corner: covers the upper part
                    of the wordmark without blocking the fullscreen toggle. */}
                <div
                  className="absolute right-0 w-[18%] bottom-[12%] h-[16%] z-10 cursor-default"
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
