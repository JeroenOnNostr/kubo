/**
 * The YouTube video currently playing inline in the feed. There is at most one
 * at a time across the whole app (starting a new embed preempts the previous).
 */
export interface ActiveVideo {
  /** YouTube video id of the currently-playing inline embed. */
  videoId: string;
  /** Frame aspect of the source tile (mirrors `YouTubeEmbedProps.aspect`). */
  aspect: 'video' | 'short';
  /**
   * Tear the inline iframe back down to its thumbnail facade — the existing
   * per-embed deactivate (`setActivated(false)` in {@link YouTubeEmbed}).
   */
  deactivate: () => void;
}

/**
 * Tiny singleton tracking "which YouTube video is playing inline".
 *
 * Replaces the old bare `activeDeactivate` module variable in YouTubeEmbed:
 * it enforces the single-active-video invariant (registering a new video
 * preempts the previous by calling its `deactivate`). Because only one embed
 * is ever `activated`, only one card can go rotate-to-fullscreen at a time —
 * the invariant the fullscreen path relies on.
 */
let current: ActiveVideo | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

/** The YouTube video currently playing inline, or `null` if none. */
export function getActiveVideo(): ActiveVideo | null {
  return current;
}

/**
 * Subscribe to active-video transitions (set / clear / preemption). The listener
 * fires on every change; read the value with {@link getActiveVideo}. Returns an
 * unsubscribe fn. Used by the kid orientation-lock controller to release the
 * portrait lock while a video is playing.
 */
export function subscribeActiveVideo(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Register the embed that just started playing. Preempts the previous one
 * (calls its `deactivate`), preserving the single-active invariant. Returns an
 * unregister fn that only clears the singleton if this entry is still the
 * active one (so a later video taking over isn't clobbered by an old cleanup).
 */
export function setActiveVideo(next: ActiveVideo): () => void {
  if (current && current.deactivate !== next.deactivate) current.deactivate();
  current = next;
  notify();
  return () => {
    if (current?.deactivate === next.deactivate) {
      current = null;
      notify();
    }
  };
}
