import { useEffect, useState } from 'react';

import { useTabletMode } from '@/hooks/useTabletMode';

/**
 * Number of kid-feed tiles per row.
 *
 *  - Tablet mode OFF (default, every device): always `1` — the single-column
 *    "phone mechanism".
 *  - Tablet mode ON: responsive by viewport width — `3` at >= 1024px (landscape
 *    / large tablets), `2` at >= 640px, `1` below that (a narrow window, or a
 *    phone that opted in). So a tablet shows 2 across in portrait, 3 in
 *    landscape.
 *
 * Shared by {@link file://./../components/feed/KidFeedList.tsx} (grid layout)
 * and {@link file://./../pages/KidHomePage.tsx} (so the "Next post" cap advances
 * a full ROW at a time) so the two never disagree about how wide a row is.
 *
 * matchMedia-based (not a bare `resize` listener) to match the codebase idiom
 * and avoid soft-keyboard churn — mirrors {@link file://./useIsLandscape.ts}.
 */
export function useKidFeedColumns(): 1 | 2 | 3 {
  const tabletMode = useTabletMode();
  const [cols, setCols] = useState<1 | 2 | 3>(() => computeCols(tabletMode));

  useEffect(() => {
    if (!tabletMode) {
      setCols(1);
      return;
    }
    const wide = window.matchMedia('(min-width: 1024px)');
    const mid = window.matchMedia('(min-width: 640px)');
    const update = () => setCols(wide.matches ? 3 : mid.matches ? 2 : 1);
    wide.addEventListener('change', update);
    mid.addEventListener('change', update);
    update();
    return () => {
      wide.removeEventListener('change', update);
      mid.removeEventListener('change', update);
    };
  }, [tabletMode]);

  return cols;
}

function computeCols(tabletMode: boolean): 1 | 2 | 3 {
  if (!tabletMode) return 1;
  if (window.matchMedia('(min-width: 1024px)').matches) return 3;
  if (window.matchMedia('(min-width: 640px)').matches) return 2;
  return 1;
}
