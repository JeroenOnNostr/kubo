import { useEffect, useState } from 'react';

/**
 * True when the viewport is tablet/desktop-class: its SMALLEST dimension is
 * >= 600 CSS px (Android's sw600dp tablet convention). Expressed as one media
 * query so it's orientation-stable — a phone browser in landscape (short side
 * < 600) stays false, unlike an aspect-ratio ("is landscape") check would.
 * Mirrors the matchMedia pattern of {@link file://./useIsLandscape.ts} and
 * useIsMobile: a `useState` initializer plus a single `change` listener (no bare
 * `resize`, which fires on soft-keyboard show/hide).
 *
 * Used together with `!Capacitor.isNativePlatform()` to auto-enable the kid
 * feed's tablet layout on desktop/tablet web, where there is no device rotation
 * and the phone mechanism (single column + rotate-to-fullscreen) can't work.
 */
const LARGE_QUERY = '(min-width: 600px) and (min-height: 600px)';

export function useIsLargeViewport(): boolean {
  const [large, setLarge] = useState(
    () => window.matchMedia(LARGE_QUERY).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(LARGE_QUERY);
    const onChange = () => setLarge(mql.matches);
    mql.addEventListener('change', onChange);
    onChange(); // resync on mount
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return large;
}
