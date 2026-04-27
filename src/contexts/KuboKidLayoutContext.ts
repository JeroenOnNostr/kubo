import { createContext, useContext, useEffect } from 'react';

/**
 * Per-route flags a /kid/* page can set on its parent KuboKidLayout.
 *
 * Kept deliberately tiny — the kid app has three routes, no need for the
 * full LayoutOptions machinery from MainLayout. Pages opt in via
 * useKidLayoutOptions({ scrollAware: true }); on unmount the flag resets.
 */
export interface KuboKidLayoutOptions {
  /**
   * If true, the shared top bar slides off-screen on scroll-down and
   * reappears on scroll-up. Default false (pinned).
   */
  scrollAware?: boolean;
}

interface KuboKidLayoutContextValue {
  setOptions: (options: KuboKidLayoutOptions) => void;
}

export const KuboKidLayoutContext =
  createContext<KuboKidLayoutContextValue | null>(null);

/**
 * Page-side hook: declare layout options for the duration of the mount.
 * Resets to {} on unmount so the next route starts clean.
 */
export function useKidLayoutOptions(options: KuboKidLayoutOptions): void {
  const ctx = useContext(KuboKidLayoutContext);
  // Stable JSON of the options so the effect only runs when values change,
  // not on every render where a fresh object is passed.
  const json = JSON.stringify(options);
  useEffect(() => {
    if (!ctx) return;
    ctx.setOptions(JSON.parse(json));
    return () => ctx.setOptions({});
    // ctx.setOptions is stable (memoized in the provider).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [json]);
}
