import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { ChevronDown } from 'lucide-react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useKuboFamily } from '@/hooks/useKuboFamily';
import { useIsLandscape } from '@/hooks/useIsLandscape';
import { cn } from '@/lib/utils';
import { findThumbnail } from '@/lib/youtubeThumbnail';
import { setActiveVideo } from '@/lib/activeVideoStore';
import { YouTubeClickEaters } from '@/components/YouTubeClickEaters';

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

  // Rotate-to-fullscreen: when this is the playing embed AND the device is
  // landscape, we promote our OWN wrapper to fixed-fullscreen via CSS. The
  // iframe is never remounted (it's the same live element, just pulled out of
  // flow visually), so the video keeps playing from where it was — no restart,
  // no jitter. Mirrors how the parent /parent/video/:id page reflows wider on
  // rotate. The store's single-active preemption guarantees only one embed is
  // `activated`, so only one card can ever be fullscreen.
  const landscape = useIsLandscape();
  const fullscreen = activated && landscape;

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

  // While activated: register as the single active video (preempting any other
  // playing embed — see activeVideoStore), and pause this one (by tearing the
  // iframe back down to the thumbnail facade) when it scrolls out of view.
  // Threshold matches usePlayerControls for native videos.
  useEffect(() => {
    if (!activated) return;

    const deactivate = () => setActivated(false);
    const unregister = setActiveVideo({ videoId, aspect, deactivate });

    // Auto-pause on scroll-out — but NOT while fullscreen. In fullscreen the
    // wrapper is pulled out of flow (position:fixed), so the observer would see
    // a displaced/zero-area rect and fire a false deactivate, collapsing
    // fullscreen the instant we rotate. Skip observing while fullscreen.
    const wrapper = wrapperRef.current;
    let observer: IntersectionObserver | undefined;
    if (wrapper && !fullscreen) {
      observer = new IntersectionObserver(
        ([entry]) => { if (!entry.isIntersecting) deactivate(); },
        { threshold: 0.25 },
      );
      observer.observe(wrapper);
    }

    return () => {
      observer?.disconnect();
      unregister();
    };
  }, [activated, videoId, aspect, fullscreen]);

  // While fullscreen: lock body scroll (the feed can't scroll behind it) and
  // let Android hardware-back collapse fullscreen before exiting kid mode.
  // Capacitor fires backButton listeners last-registered-first, so this runs
  // ahead of useKidBackGuard. Dynamic-import keeps @capacitor/app off the web
  // critical path (mirrors useKidBackGuard).
  useEffect(() => {
    if (!fullscreen) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    let cleanupBack: (() => void) | undefined;
    let cancelled = false;
    if (Capacitor.isNativePlatform()) {
      (async () => {
        const { App } = await import('@capacitor/app');
        const listener = await App.addListener('backButton', () =>
          setActivated(false),
        );
        if (cancelled) {
          listener.remove();
          return;
        }
        cleanupBack = () => listener.remove();
      })();
    }

    return () => {
      cancelled = true;
      cleanupBack?.();
      document.body.style.overflow = prevOverflow;
    };
  }, [fullscreen]);

  return (
    <div
      ref={wrapperRef}
      className={cn(
        fullscreen
          ? 'fixed inset-0 z-[2147483000] bg-black flex items-center justify-center'
          : cn('rounded-xl overflow-hidden', className),
      )}
      // In landscape fullscreen, keep the video clear of a side notch. The
      // .safe-area-* utilities only cover top/bottom, so use the CSS vars
      // (SystemBars-injected) directly with an env() fallback.
      style={
        fullscreen
          ? {
              paddingLeft: 'var(--safe-area-inset-left, env(safe-area-inset-left, 0px))',
              paddingRight: 'var(--safe-area-inset-right, env(safe-area-inset-right, 0px))',
            }
          : undefined
      }
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="relative w-full"
        style={{
          aspectRatio: aspect === 'short' ? '9 / 16' : '16 / 9',
          ...(fullscreen ? { maxHeight: '100%', maxWidth: '100%' } : null),
        }}
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
            {/* Kid-mode click-eaters masking YouTube's escape affordances.
                Inside the wrapper, so they ride along into fullscreen and the
                geometry stays size-agnostic. Only painted when the iframe is
                mounted. */}
            {isKidMode && <YouTubeClickEaters />}

            {/* Tap-to-exit in fullscreen — kids may not rotate back. Large,
                high-contrast, above the click-eaters, in the top-left safe
                area. Drops back to the inline facade (which also exits
                fullscreen since activated→false). */}
            {fullscreen && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setActivated(false);
                }}
                aria-label="Back to feed"
                className="absolute top-3 left-3 z-20 size-11 rounded-full bg-black/50 text-white flex items-center justify-center active:scale-95 transition-transform"
                style={{
                  marginTop: 'var(--safe-area-inset-top, env(safe-area-inset-top, 0px))',
                  marginLeft: 'var(--safe-area-inset-left, env(safe-area-inset-left, 0px))',
                }}
              >
                <ChevronDown className="size-6" />
              </button>
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
