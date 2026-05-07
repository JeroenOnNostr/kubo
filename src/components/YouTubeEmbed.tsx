import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

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
 * YouTube thumbnail sizes to try, in preference order.
 *
 * - `sddefault.jpg` (640×480) — available for most videos, good enough for the
 *   ~568px max render width on desktop (even on 2x Retina it's acceptable for
 *   a temporary thumbnail that gets replaced by an iframe on click)
 * - `hqdefault.jpg` (480×360) — universally available fallback with letterbox bars
 *
 * `maxresdefault.jpg` (1280×720) is omitted intentionally: it 404s for many
 * videos, and in a feed with multiple YouTube links the wasted requests add up.
 * The thumbnail is disposable — it only exists until the user clicks play.
 *
 * YouTube's CDN serves a 120×90 gray placeholder when a requested size doesn't
 * exist. We probe off-screen with `new Image()` and check naturalWidth to detect
 * this, so the gray image is never rendered visibly.
 */
const THUMBNAIL_SIZES = ['sddefault', 'hqdefault'] as const;

function thumbnailUrl(videoId: string, size: string): string {
  return `https://i.ytimg.com/vi/${videoId}/${size}.jpg`;
}

/** Probe thumbnail sizes off-screen and resolve with the first valid URL. */
function findThumbnail(videoId: string): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;

    function tryIndex(i: number) {
      if (i >= THUMBNAIL_SIZES.length) {
        if (!settled) {
          settled = true;
          resolve(null);
        }
        return;
      }

      const img = new Image();
      img.onload = () => {
        if (settled) return;
        // YouTube serves a 120×90 gray placeholder when the size doesn't exist.
        if (img.naturalWidth <= 120 && img.naturalHeight <= 90) {
          tryIndex(i + 1);
        } else {
          settled = true;
          resolve(thumbnailUrl(videoId, THUMBNAIL_SIZES[i]));
        }
      };
      img.onerror = () => {
        if (!settled) tryIndex(i + 1);
      };
      img.src = thumbnailUrl(videoId, THUMBNAIL_SIZES[i]);
    }

    tryIndex(0);
  });
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
          // Stretched 1px beyond the wrapper on bottom/right to hide the
          // sub-pixel hairline that aspect-ratio rounding can leave between
          // the iframe edge and the parent's overflow-hidden clip.
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&enablejsapi=1`}
            title="YouTube video"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            sandbox="allow-scripts allow-same-origin allow-presentation"
            className="absolute inset-0 w-full h-full -mb-px -mr-px"
          />
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
