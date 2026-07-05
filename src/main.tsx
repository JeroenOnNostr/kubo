import { createRoot } from 'react-dom/client';

// Import polyfills first
import './lib/polyfills.ts';

// Kick off cache hydration early so data is ready before components render.
import { hydrateNip05Cache } from '@/lib/nip05Cache';
import { hydrateProfileCache } from '@/lib/profileCache';
hydrateNip05Cache();
hydrateProfileCache();

import { ErrorBoundary } from '@/components/ErrorBoundary';
import App from './App.tsx';
import './index.css';

import '@fontsource-variable/inter';

// ─── Native status bar theming (Android APK / iOS) ───────────────────────────
// Keeps the OS top chrome in sync with the active app theme.
// Runs before React so the very first paint matches the persisted theme.
// Uses a MutationObserver so it reacts to all subsequent theme changes
// (class changes for builtin themes, style-content changes for custom themes).
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { getBackgroundThemeMode } from '@/lib/colorUtils';

if (Capacitor.isNativePlatform()) {
  // Hide the iOS keyboard accessory bar (prev/next/done toolbar above the keyboard).
  // Only runs on iOS — setAccessoryBarVisible is unimplemented on Android.
  if (Capacitor.getPlatform() === 'ios') {
    import('@capacitor/keyboard').then(({ Keyboard }) => {
      Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => {});
    }).catch(() => {});
  }

  /**
   * Android: keep bottom action buttons above the soft keyboard.
   *
   * Goal: when the keyboard opens, the primary CTA (e.g. onboarding's
   * "Continue" / "Add kid") should ride up with it instead of being hidden
   * behind it. We publish the live keyboard height as the CSS custom property
   * `--keyboard-height`, and layouts pad their bottom by it.
   *
   * Mechanism:
   *  - `virtualKeyboard.overlaysContent = true` puts the WebView in "overlay"
   *    mode: the keyboard covers the page and the LAYOUT viewport stays full
   *    height (window.innerHeight is unchanged), while the VISUAL viewport
   *    (window.visualViewport) shrinks by the keyboard. That keeps our height
   *    math stable and predictable.
   *  - Capacitor Keyboard resize `none` stops the plugin from ALSO resizing the
   *    native WebView (which is unreliable under edge-to-edge on Android 15/16
   *    and would fight the overlay model).
   *  - We then derive the keyboard height from the visualViewport delta. NOTE:
   *    Android WebView does NOT populate the env(keyboard-inset-*) CSS vars even
   *    with overlaysContent set (that geometry is only wired up in full Chrome),
   *    so reading env() is useless here — visualViewport is the reliable signal.
   *
   * iOS is intentionally left on the default native resize: WKWebView doesn't
   * implement the VirtualKeyboard API, its native resize shrinks the layout
   * viewport correctly, and `--keyboard-height` simply stays unset (0) there.
   */
  if (Capacitor.getPlatform() === 'android') {
    const vk = (navigator as unknown as {
      virtualKeyboard?: { overlaysContent: boolean };
    }).virtualKeyboard;
    const vv = window.visualViewport;
    // Only take over keyboard handling when both the VirtualKeyboard API (to
    // force overlay mode) and the visualViewport API (to measure it) exist. On
    // an older WebView, leaving Capacitor's native resize in place is the
    // safer fallback.
    if (vk && vv) {
      vk.overlaysContent = true;
      import('@capacitor/keyboard').then(({ Keyboard, KeyboardResize }) => {
        Keyboard.setResizeMode({ mode: KeyboardResize.None }).catch(() => {});
      }).catch(() => {});

      const root = document.documentElement;
      const syncKeyboardHeight = () => {
        // In overlay mode the layout viewport is full height and the visual
        // viewport shrinks by the keyboard; the bottom gap is its height.
        const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        // Threshold guards against sub-pixel jitter reporting a 1px keyboard.
        root.style.setProperty('--keyboard-height', kb > 1 ? `${Math.round(kb)}px` : '0px');
      };
      vv.addEventListener('resize', syncKeyboardHeight);
      vv.addEventListener('scroll', syncKeyboardHeight);
      syncKeyboardHeight();
    }
  }
  /**
   * Sync the native system bar icon style with the active CSS theme.
   *
   * SystemBarsStyle.Dark  = light/white icons (use on dark backgrounds)
   * SystemBarsStyle.Light = dark/black icons  (use on light backgrounds)
   *
   * On Android 16+ (API 36) setBackgroundColor no longer works — the bars
   * are transparent and the web content renders behind them. The app already
   * draws its own safe-area backgrounds in CSS, so only icon style matters.
   */
  function updateStatusBar() {
    const isDark = getBackgroundThemeMode() === 'dark';
    SystemBars.setStyle({ style: isDark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {});
  }

  // Apply immediately (theme class is set synchronously by AppProvider useLayoutEffect
  // before the first React paint, but we still try early in case it's already set).
  updateStatusBar();

  // Re-apply whenever the theme class changes on <html> (light / dark / custom)
  const classObserver = new MutationObserver(() => updateStatusBar());
  classObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });

  // Re-apply whenever the injected <style id="theme-vars"> content changes
  // (covers custom themes that change CSS variables without changing the class).
  const styleObserver = new MutationObserver(() => updateStatusBar());
  const observeThemeVars = () => {
    const el = document.getElementById('theme-vars');
    if (el) {
      styleObserver.observe(el, { characterData: true, childList: true, subtree: true });
    }
  };
  // The style element may not exist yet — watch <head> for it to appear.
  observeThemeVars();
  const headObserver = new MutationObserver(() => observeThemeVars());
  headObserver.observe(document.head, { childList: true });
}
// ─────────────────────────────────────────────────────────────────────────────

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

// NOTE: the #preloader is removed inside <App> via useLayoutEffect (not here
// via requestAnimationFrame). A blind rAF removed it before React's first
// paint, leaving a blank-blue frame between the static preloader and the
// React loading screen. useLayoutEffect runs after the first commit's DOM is
// in place but before paint, so the React splash is already on screen when
// the preloader is removed — no flash, no font/layout jump.
