import { useMemo } from 'react';

import { builtinThemes, coreToTokens, toThemeVar } from '@/themes';

/**
 * Radix primitives that portal — `Dialog`, `DropdownMenu`, `Popover`,
 * `Tooltip`, etc. — render their content out of the React tree to
 * <body>, which sits outside the parent layout's `ScopedTheme`
 * wrapper. As a result, descendants of those portalled containers
 * fall back to the global (light) shadcn defaults, so a popup
 * rendered inside Kubo's parent layout would look white-on-white.
 *
 * This hook returns CSS-variable inline styles for Kubo's dark
 * theme so the portalled root (e.g. `DialogContent`,
 * `DropdownMenuContent`) can re-apply them via `style={...}` and
 * every descendant resolves correctly.
 */
export function usePortalDarkTheme(): React.CSSProperties {
  return useMemo(() => {
    const tokens = coreToTokens(builtinThemes.dark);
    const vars: Record<string, string> = {};
    for (const [key, val] of Object.entries(tokens) as [string, string][]) {
      vars[toThemeVar(key)] = val;
    }
    return vars as React.CSSProperties;
  }, []);
}
