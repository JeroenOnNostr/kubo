import { useEffect, useLayoutEffect, useState } from 'react';

import { KuboMark } from '@/components/KuboMark';
import { dismissPreloader } from '@/lib/preloader';

/**
 * Full-screen kid-app loading splash — the re-armable React twin of the static
 * `#preloader` in index.html (KUBO-xxx).
 *
 * The static `#preloader` can only be shown ONCE: `dismissPreloader()` removes
 * its DOM node and latches a module flag, so it can't cover later transitions
 * where the feed reloads (finishing onboarding, or a parent swapping back into
 * a kid's feed from the parent view). This component is React-state-driven, so
 * it can be re-shown on every such transition.
 *
 * On mount it calls `dismissPreloader()` in a layout effect so the static node
 * is removed the instant this pixel-identical twin paints — the cold-boot
 * handoff (static splash → this overlay) is invisible. It then stays up until
 * its host (`KidHomePage`) hides it once the feed is ready.
 *
 * KEEP IN SYNC with:
 * - the `#preloader` markup in index.html (lines ~42-76)
 * - `KuboMark.tsx` (the logo, reused here)
 * The three keyframes (`ditto-spin`, `kubo-ping`, `kubo-pulse`) are defined
 * once, globally, in index.html's <head> and reused here.
 *
 * Font is system-ui ONLY (no Inter): this paints before/around the Inter
 * webfont and matching the static preloader avoids a font-display:swap reflow.
 */

interface KuboLoadingScreenProps {
  /** When false, the overlay fades out and unmounts itself. Default true. */
  visible?: boolean;
  className?: string;
}

const FADE_MS = 200;

export function KuboLoadingScreen({
  visible = true,
  className,
}: KuboLoadingScreenProps) {
  // Remove the static #preloader as soon as this twin has painted, so on cold
  // boot only one of the two is ever the live element after React's first
  // commit. They're pixel-identical, so the swap is invisible. Idempotent and
  // a no-op on the re-entry transitions (the static node is already gone).
  useLayoutEffect(() => {
    dismissPreloader();
  }, []);

  // Mount visibly, then fade out (rather than unmount immediately) when
  // `visible` flips false, mirroring the static preloader's 200ms fade so the
  // reveal of the already-painted feed underneath isn't an abrupt cut.
  const [render, setRender] = useState(true);
  useEffect(() => {
    if (visible) {
      setRender(true);
      return;
    }
    const t = setTimeout(() => setRender(false), FADE_MS + 40);
    return () => clearTimeout(t);
  }, [visible]);

  if (!render) return null;

  return (
    <div
      aria-hidden="true"
      className={className}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#1E3A8A',
        opacity: visible ? 1 : 0,
        transition: `opacity ${FADE_MS}ms ease-out`,
        pointerEvents: visible ? 'auto' : 'none',
        fontFamily:
          "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif",
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 32,
          textAlign: 'center',
          maxWidth: '24rem',
          padding: '0 1.5rem',
        }}
      >
        {/* Logo with gentle pulse halo */}
        <div style={{ position: 'relative' }}>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: 9999,
              background: 'rgba(255,255,255,0.2)',
              opacity: 0.3,
              animation: 'kubo-ping 1s cubic-bezier(0,0,.2,1) infinite',
            }}
          />
          <KuboMark size={72} className="relative" />
        </div>

        {/* Spinner + text */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <div style={{ position: 'relative', width: 40, height: 40 }}>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: 9999,
                border: '2.5px solid rgba(255,255,255,0.2)',
              }}
            />
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: 9999,
                border: '2.5px solid transparent',
                borderTopColor: '#ffffff',
                animation: 'ditto-spin 1s linear infinite',
              }}
            />
          </div>
          <p
            style={{
              margin: 0,
              fontSize: 14,
              lineHeight: '20px',
              fontWeight: 500,
              color: '#ffffff',
            }}
          >
            Getting your videos ready…
          </p>
        </div>

        {/* Animated dots */}
        <div style={{ display: 'flex', gap: 6 }}>
          {[0, 200, 400].map((delay) => (
            <div
              key={delay}
              style={{
                width: 6,
                height: 6,
                borderRadius: 9999,
                background: 'rgba(255,255,255,0.4)',
                animation: 'kubo-pulse 2s cubic-bezier(.4,0,.6,1) infinite',
                animationDelay: `${delay}ms`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
