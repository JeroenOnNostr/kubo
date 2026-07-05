import { describe, it, expect, vi } from 'vitest';

import {
  getActiveVideo,
  setActiveVideo,
  subscribeActiveVideo,
  type ActiveVideo,
} from './activeVideoStore';

function makeVideo(id: string): ActiveVideo {
  return { videoId: id, aspect: 'video', deactivate: vi.fn() };
}

describe('activeVideoStore', () => {
  it('emits on set and clear, and getActiveVideo reflects the current state', () => {
    const seen: (string | null)[] = [];
    const unsub = subscribeActiveVideo(() =>
      seen.push(getActiveVideo()?.videoId ?? null),
    );
    expect(getActiveVideo()).toBeNull();

    const a = makeVideo('a');
    const unregA = setActiveVideo(a);
    expect(getActiveVideo()?.videoId).toBe('a');

    unregA();
    expect(getActiveVideo()).toBeNull();

    unsub();
    // Listener fired once for the set, once for the clear.
    expect(seen).toEqual(['a', null]);
  });

  it('preempts the previous video and keeps a video active across the swap', () => {
    const a = makeVideo('a');
    const b = makeVideo('b');

    const unregA = setActiveVideo(a);
    const unregB = setActiveVideo(b); // preempts a
    expect(a.deactivate).toHaveBeenCalledTimes(1);
    expect(getActiveVideo()?.videoId).toBe('b');

    // a's stale cleanup must NOT clear b (it isn't the active entry anymore).
    unregA();
    expect(getActiveVideo()?.videoId).toBe('b');

    unregB();
    expect(getActiveVideo()).toBeNull();
  });
});
