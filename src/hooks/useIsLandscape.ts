import { useEffect, useState } from 'react';

/**
 * True when the WebView viewport is in landscape (wider than tall).
 *
 * Driven by a `matchMedia('(orientation: landscape)')` change listener —
 * mirrors {@link useIsMobile}'s pattern. This is the most reliable signal in
 * the Capacitor Android WebView: the activity is NOT orientation-locked
 * (AndroidManifest has `configChanges` incl. `orientation` but no
 * `android:screenOrientation`), so on physical rotation the WebView viewport
 * genuinely becomes wide and the query flips. That's the SAME signal that makes
 * a `fixed inset:0` overlay fill the rotated viewport, so detection and layout
 * stay consistent — they read the same viewport.
 *
 * We deliberately avoid:
 *  - `screen.orientation` — reports the device/screen, not the (possibly
 *    differently-sized) viewport, and the plugin isn't installed.
 *  - the bare `resize` event — fires on soft-keyboard show/hide (the viewport
 *    meta uses `interactive-widget=resizes-content`), producing false flips.
 *
 * The media query only fires on a true aspect-ratio cross, which also safely
 * handles foldable (Pixel 9 Pro Fold) square states.
 */
export function useIsLandscape(): boolean {
  const [landscape, setLandscape] = useState(
    () => window.matchMedia('(orientation: landscape)').matches,
  );

  useEffect(() => {
    const mql = window.matchMedia('(orientation: landscape)');
    const onChange = () => setLandscape(mql.matches);
    mql.addEventListener('change', onChange);
    onChange(); // resync on mount
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return landscape;
}
