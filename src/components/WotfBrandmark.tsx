import { useEffect, useState } from 'react';

import { loadBundledFont, resolveCssFamily } from '@/lib/fonts';
import { cn } from '@/lib/utils';

/**
 * Web of Trust Foundation logo mark — the spiral, bundled locally so it paints
 * offline and instantly (public/wotf-logo-{light,dark}.png). The two variants
 * are toggled by Tailwind's `dark:` modifier — the app sets
 * `documentElement.className` to `light`/`dark` (see useTheme.ts), which drives
 * those variants. `logo-light` is the dark-inked mark for light backgrounds;
 * `logo-dark` is the light/white mark for dark backgrounds (the website's
 * naming is inverted relative to which mode it's shown in).
 */
export function WotfLogo({ className }: { className?: string }) {
  return (
    <>
      <img
        src="/wotf-logo-light.png"
        className={cn('dark:hidden', className)}
        alt=""
        aria-hidden
      />
      <img
        src="/wotf-logo-dark.png"
        className={cn('hidden dark:block', className)}
        alt=""
        aria-hidden
      />
    </>
  );
}

/**
 * "Web of Trust Foundation" wordmark in Merriweather — the foundation's brand
 * serif, mirroring the header on weboftrustfoundation.com. Merriweather is
 * already bundled in Kubo (see src/lib/fonts.ts); we load it lazily and only
 * swap the text to it once the CSS is in, falling back to the app's serif stack
 * until then so there is no invisible-text flash.
 */
export function WotfWordmark({ className }: { className?: string }) {
  const [fontReady, setFontReady] = useState(false);

  useEffect(() => {
    let active = true;
    void loadBundledFont('Merriweather').then(() => {
      if (active) setFontReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <span
      className={cn('font-serif font-bold leading-tight', className)}
      style={fontReady ? { fontFamily: resolveCssFamily('Merriweather') } : undefined}
    >
      Web of Trust Foundation
    </span>
  );
}

/**
 * Web of Trust Foundation brand lockup — logo + wordmark, side by side.
 * Carries an accessible name so the imgs can stay decorative.
 */
export function WotfBrandmark({ className }: { className?: string }) {
  return (
    <div
      className={cn('flex items-center gap-2.5', className)}
      aria-label="Web of Trust Foundation"
    >
      <WotfLogo className="size-6" />
      <WotfWordmark className="text-base text-foreground/90" />
    </div>
  );
}
