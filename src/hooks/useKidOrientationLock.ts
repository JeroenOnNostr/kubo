import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';

import { getActiveVideo, subscribeActiveVideo } from '@/lib/activeVideoStore';
import { useTabletMode } from '@/hooks/useTabletMode';

/**
 * While in the kid app on a NATIVE device with tablet mode OFF, pin the screen
 * to portrait so rotating the device does not rotate the feed — EXCEPT while a
 * video is playing inline, when we release the lock so the existing
 * rotate-to-landscape → fullscreen behavior still works. The lock is re-applied
 * when playback stops and fully released when the kid app unmounts.
 *
 *  - Tablet mode ON → both orientations free (no lock); rotate-to-fullscreen is
 *    disabled in {@link file://./../components/YouTubeEmbed.tsx} and fullscreen
 *    is reached via the expand button instead.
 *  - Web → no-op (browsers can't be reliably orientation-locked).
 *
 * Mount once at the kid-layout level so it covers every /kid/* route.
 */
export function useKidOrientationLock(): void {
  const tabletMode = useTabletMode();

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || tabletMode) return;

    let disposed = false;
    let lockPortrait: (() => void) | null = null;
    let unlock: (() => void) | null = null;
    let videoActive = getActiveVideo() !== null;

    // Apply the correct orientation state for the current playback flag.
    const apply = () => {
      if (disposed || !lockPortrait || !unlock) return;
      if (videoActive) unlock();
      else lockPortrait();
    };

    (async () => {
      const { ScreenOrientation } = await import('@capacitor/screen-orientation');
      if (disposed) return; // unmounted before the plugin loaded — never lock
      lockPortrait = () => {
        ScreenOrientation.lock({ orientation: 'portrait' }).catch(() => {});
      };
      unlock = () => {
        ScreenOrientation.unlock().catch(() => {});
      };
      apply();
    })();

    const unsub = subscribeActiveVideo(() => {
      videoActive = getActiveVideo() !== null;
      apply();
    });

    return () => {
      disposed = true;
      unsub();
      unlock?.(); // restore free rotation when leaving the kid app
    };
  }, [tabletMode]);
}
