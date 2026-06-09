import { useEffect, useState } from 'react';

import { extractYouTubeId } from '@/lib/linkEmbed';
import type { FeedItem } from '@/lib/feedUtils';
import { isYouTubeUrl, parseVideoImeta } from '@/lib/videoEvent';
import { findThumbnail } from '@/lib/youtubeThumbnail';

/**
 * Warm the thumbnails for the first N *visible* video tiles in the kid feed so
 * the boot splash can be held until they're ready — then the feed reveals
 * already painted instead of popping thumbnails in. (KUBO-140)
 *
 * Reuses the exact probe the tiles use (`findThumbnail` for YouTube), which
 * loads the image into the browser HTTP cache; when the real tile mounts its
 * `<img>` paints from cache with no visible fetch. So this delivers both
 * "hold until ready" and "load faster" with no changes to the tile components.
 *
 * Returns `ready`, which flips true exactly once when the first N video
 * thumbnails are warmed OR a safety deadline fires — so a slow/missing/failed
 * thumbnail can never hang boot. Layered under KidHomePage's 10s and
 * lib/preloader's 11s backstops.
 */

const PER_ITEM_MS = 1500;
const OVERALL_MS = 2500;

type Target =
  | { kind: 'youtube'; videoId: string }
  | { kind: 'poster'; url: string }
  | { kind: 'nopost' };

/** Classify a feed item into a warmable thumbnail target, or null if not a video. */
function classify(item: FeedItem): Target | null {
  const event = item.event;

  // NIP-71 video event.
  if (event.kind === 21 || event.kind === 22) {
    const { url, thumbnail } = parseVideoImeta(event.tags);
    if (url && isYouTubeUrl(url)) {
      const id = extractYouTubeId(url);
      if (id) return { kind: 'youtube', videoId: id };
    }
    if (thumbnail) return { kind: 'poster', url: thumbnail };
    // No quick poster and not YouTube — its frame is generated lazily by the
    // tile; don't block boot on it.
    return { kind: 'nopost' };
  }

  // Text note with a standalone YouTube link (rendered as a YouTubeEmbed).
  if (event.kind === 1) {
    for (const token of event.content.split(/\s+/)) {
      const id = extractYouTubeId(token);
      if (id) return { kind: 'youtube', videoId: id };
    }
  }

  return null;
}

/** Resolve when the target's thumbnail is warmed — always settles, never rejects. */
function warm(target: Target): Promise<void> {
  switch (target.kind) {
    case 'youtube':
      // findThumbnail settles (URL or null) once the off-screen probe completes.
      return findThumbnail(target.videoId).then(() => undefined);
    case 'poster':
      return new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = target.url;
      });
    case 'nopost':
      return Promise.resolve();
  }
}

function withTimeout(p: Promise<void>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const t = setTimeout(finish, ms);
    p.then(() => {
      clearTimeout(t);
      finish();
    });
  });
}

export function usePrefetchKidThumbnails(
  feedItems: FeedItem[],
  { n = 3, enabled = true }: { n?: number; enabled?: boolean } = {},
): boolean {
  const [ready, setReady] = useState(false);

  // Stable signature of the first slice. The effect is keyed on it, so:
  // - a background refetch of the SAME events → same signature → no re-run
  //   (dedupe), and
  // - a genuine feed change (e.g. kid swap) → new signature → re-arm.
  // First 10 ids is plenty to cover the first N video tiles.
  const signature = feedItems.slice(0, 10).map((i) => i.event.id).join(',');
  const keyedItems = feedItems.slice(0, 10);

  useEffect(() => {
    if (!enabled) return;

    // Re-arm for this feed (false until warmed/timed-out).
    setReady(false);

    let fired = false;
    const fire = () => {
      if (fired) return;
      fired = true;
      setReady(true);
    };

    // Collect the first N video targets in feed order.
    const targets: Target[] = [];
    for (const item of keyedItems) {
      const t = classify(item);
      if (t) targets.push(t);
      if (targets.length >= n) break;
    }

    if (targets.length === 0) {
      fire();
      return;
    }

    const overall = setTimeout(fire, OVERALL_MS);

    Promise.all(targets.map((t) => withTimeout(warm(t), PER_ITEM_MS))).then(() => {
      clearTimeout(overall);
      fire();
    });

    return () => {
      fired = true; // ignore late settles after re-arm/unmount
      clearTimeout(overall);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, enabled, n]);

  return ready;
}
