import { useMemo, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';

import { TourAnchorContext, type TourAnchorStore } from '@/contexts/TourAnchorContext';

/**
 * Provider for the named-anchor registry used by the first-run parent tour
 * (KUBO-092). Mounted by KuboKidLayout and KuboParentLayout so each
 * layout's anchored components and tour orchestrator share a registry.
 *
 * The two layouts mount independent providers — that's intentional. Only
 * one of them is on screen at a time (the route is either `/kid/*` or
 * `/parent/*`), so the tour state singleton in `src/lib/tourState.ts` is
 * the only thing that needs to bridge the two.
 */
export function TourAnchorProvider({ children }: { children: ReactNode }) {
  const map = useRef<Map<string, RefObject<HTMLElement | null>>>(new Map());
  const subs = useRef<Set<() => void>>(new Set());

  const store = useMemo<TourAnchorStore>(() => ({
    subscribe: (cb) => {
      subs.current.add(cb);
      return () => {
        subs.current.delete(cb);
      };
    },
    get: () => map.current,
    register: (name, ref) => {
      map.current.set(name, ref);
      subs.current.forEach((cb) => cb());
      return () => {
        // Only remove if it's still us — guards against the unmount of an
        // older instance clobbering a newer registration.
        if (map.current.get(name) === ref) {
          map.current.delete(name);
          subs.current.forEach((cb) => cb());
        }
      };
    },
  }), []);

  return (
    <TourAnchorContext.Provider value={store}>
      {children}
    </TourAnchorContext.Provider>
  );
}
