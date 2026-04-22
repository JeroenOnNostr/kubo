/**
 * Kubo-themed fallbacks for the shared Ditto <ErrorBoundary fallback={…}>.
 *
 * Wrapping each Kubo layout with its own ErrorBoundary + one of these
 * fallbacks keeps the shared boundary untouched (forward-compatible with
 * upstream merges) while making a crash on /kid show the kid's deep-blue
 * palette and parent-friendly copy, and a crash on /parent/* show the
 * parent's dark chrome.
 */

/** Fallback for the kid app — deep blue, reassuring, points to a grown-up. */
export function KuboKidErrorFallback() {
  return (
    <div
      className="min-h-dvh flex flex-col items-center justify-center gap-5 px-6 text-center text-white"
      style={{ background: '#1E3A8A' }}
    >
      <div className="size-16 rounded-2xl bg-white/10 flex items-center justify-center">
        <span className="text-3xl" aria-hidden>
          🛠️
        </span>
      </div>
      <div className="space-y-1.5 max-w-xs">
        <h2 className="text-xl font-semibold">Something's broken.</h2>
        <p className="text-sm text-white/80 leading-relaxed">
          Ask a grown-up to help — they can tap below to try again.
        </p>
      </div>
      <button
        onClick={() => window.location.reload()}
        className="h-11 px-6 rounded-full bg-white text-[#1E3A8A] font-medium active:scale-95 transition-transform"
      >
        Try again
      </button>
    </div>
  );
}

/** Fallback for the parent app — parent-themed dark, honest error copy. */
export function KuboParentErrorFallback({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="min-h-dvh bg-background text-foreground flex flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="size-16 rounded-2xl bg-muted flex items-center justify-center">
        <span className="text-3xl" aria-hidden>
          ⚠️
        </span>
      </div>
      <div className="space-y-1.5 max-w-sm">
        <h2 className="text-xl font-semibold">Something went wrong</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          We couldn't render this page. The error's been recorded — try again
          or reload.
        </p>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onRetry ?? (() => window.location.reload())}
          className="h-11 px-5 rounded-full bg-primary text-primary-foreground font-medium active:scale-95 transition-transform"
        >
          Try again
        </button>
        <button
          onClick={() => window.location.reload()}
          className="h-11 px-5 rounded-full bg-secondary text-secondary-foreground font-medium active:scale-95 transition-transform"
        >
          Reload
        </button>
      </div>
    </div>
  );
}

/** Fallback for the onboarding flow — matches the beige welcome background. */
export function KuboOnboardErrorFallback() {
  return (
    <div className="min-h-dvh bg-background text-foreground flex flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="size-16 rounded-2xl bg-muted flex items-center justify-center">
        <span className="text-3xl" aria-hidden>
          ⚠️
        </span>
      </div>
      <div className="space-y-1.5 max-w-sm">
        <h2 className="text-xl font-semibold">Setup hit a snag</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Don't worry — no data's been lost. Reload to start over.
        </p>
      </div>
      <button
        onClick={() => window.location.reload()}
        className="h-11 px-5 rounded-full bg-primary text-primary-foreground font-medium active:scale-95 transition-transform"
      >
        Reload
      </button>
    </div>
  );
}
