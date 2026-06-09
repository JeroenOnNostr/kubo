/**
 * YouTube thumbnail resolution — shared between the live `YouTubeEmbed` facade
 * and the boot-time prefetch (`usePrefetchKidThumbnails`). Extracted here so
 * both use the exact same probe and warm the same browser HTTP cache: the
 * prefetch loads these first, so when the tile mounts its `<img>` paints
 * instantly. (KUBO-140)
 *
 * YouTube thumbnail sizes to try, in preference order:
 * - `sddefault.jpg` (640×480) — available for most videos, good enough for the
 *   ~568px max render width.
 * - `hqdefault.jpg` (480×360) — universally available fallback (letterboxed).
 *
 * `maxresdefault.jpg` (1280×720) is omitted intentionally: it 404s for many
 * videos and the wasted requests add up in a multi-video feed. The thumbnail
 * is disposable — it only exists until the user clicks play.
 *
 * YouTube's CDN serves a 120×90 gray placeholder when a requested size doesn't
 * exist; we probe off-screen with `new Image()` and check naturalWidth to
 * detect this, so the gray image is never rendered.
 */

export const THUMBNAIL_SIZES = ['sddefault', 'hqdefault'] as const;

export function thumbnailUrl(videoId: string, size: string): string {
  return `https://i.ytimg.com/vi/${videoId}/${size}.jpg`;
}

/** A loaded image whose dimensions reveal it's YouTube's gray placeholder. */
function isPlaceholder(img: HTMLImageElement): boolean {
  return img.naturalWidth <= 120 && img.naturalHeight <= 90;
}

/**
 * Probe the thumbnail sizes **in parallel** and resolve with the first valid
 * URL, preferring the higher-quality size when more than one is valid. Resolves
 * `null` when none exist. Always settles (never rejects) — callers can treat a
 * settle as "done" regardless of outcome.
 *
 * Parallel (vs. the old sequential sddefault→hqdefault) shaves a round-trip off
 * every YouTube tile.
 */
export function findThumbnail(videoId: string): Promise<string | null> {
  return new Promise((resolve) => {
    // Track each size's outcome so we can prefer the earliest (highest-quality)
    // valid one even if a later size resolves first.
    const results: (boolean | undefined)[] = new Array(THUMBNAIL_SIZES.length);
    let settled = false;

    const settleFromResults = () => {
      if (settled) return;
      // Resolve as soon as we can decide the best available in preference order:
      // the first index that is valid, but only once every earlier index is known.
      for (let i = 0; i < THUMBNAIL_SIZES.length; i++) {
        if (results[i] === undefined) return; // earlier outcome still pending
        if (results[i] === true) {
          settled = true;
          resolve(thumbnailUrl(videoId, THUMBNAIL_SIZES[i]));
          return;
        }
      }
      // All known and none valid.
      settled = true;
      resolve(null);
    };

    THUMBNAIL_SIZES.forEach((size, i) => {
      const img = new Image();
      img.onload = () => {
        results[i] = !isPlaceholder(img);
        settleFromResults();
      };
      img.onerror = () => {
        results[i] = false;
        settleFromResults();
      };
      img.src = thumbnailUrl(videoId, size);
    });
  });
}
