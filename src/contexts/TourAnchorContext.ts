import { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';

/**
 * Named anchor registry for the first-run parent tour (KUBO-092).
 *
 * Components that the tour needs to attach popovers to call
 * `useRegisterTourAnchor('name', ref)` to register their DOM node. The tour
 * orchestrator calls `useTourAnchor('name')` to read the current ref and
 * pass it to Radix's `<PopoverAnchor virtualRef={ref}>`.
 *
 * The provider component itself lives in
 * src/components/tour/TourAnchorProvider.tsx (split per the codebase
 * convention of keeping `useContext` hooks in `.ts` files separate from
 * Provider JSX).
 */
type AnchorMap = Map<string, RefObject<HTMLElement | null>>;

export interface TourAnchorStore {
  subscribe: (cb: () => void) => () => void;
  get: () => AnchorMap;
  register: (name: string, ref: RefObject<HTMLElement | null>) => () => void;
}

export const TourAnchorContext = createContext<TourAnchorStore | null>(null);

/**
 * Register a DOM ref under a stable name. No-op if not inside a
 * TourAnchorProvider — keeps anchored components safe to mount in stories /
 * isolated tests.
 */
export function useRegisterTourAnchor<T extends HTMLElement>(
  name: string,
  ref: RefObject<T | null>,
): void {
  const store = useContext(TourAnchorContext);
  useEffect(() => {
    if (!store) return;
    return store.register(name, ref as RefObject<HTMLElement | null>);
  }, [store, name, ref]);
}

/**
 * Look up a registered anchor by name. Returns `null` if no component has
 * registered under that name yet, and re-renders the consumer when a matching
 * anchor mounts later.
 */
export function useTourAnchor(name: string): RefObject<HTMLElement | null> | null {
  const store = useContext(TourAnchorContext);
  const snapshot = useSyncExternalStore(
    useCallback((cb) => store?.subscribe(cb) ?? (() => {}), [store]),
    useCallback(() => store?.get() ?? null, [store]),
    useCallback(() => store?.get() ?? null, [store]),
  );
  return snapshot?.get(name) ?? null;
}
