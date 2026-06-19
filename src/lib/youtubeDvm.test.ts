import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useYouTubeDvm } from './youtubeDvm';

/**
 * Regression: the YouTube page debounces search-as-you-type in a
 * `useEffect([query])` that calls `dvm.search`. If `useYouTubeDvm()` returned a
 * fresh object (or fresh `search`/`watch` closures) on every render, that effect
 * — together with the `setResults`/`setSearching` calls inside the search — would
 * re-fire on every render, producing a render→search→setState→render loop (seen
 * in the field as /v1/search spamming forever). These tests pin the hook's
 * identity stability so that loop can't come back.
 *
 * The hook's inputs (nostr pool, publish mutation, parent signer) are stable
 * across renders in the app (context / react-query), so we mock them as stable
 * and assert the hook's output is stable too.
 */

const stableNostr = { req: vi.fn() };
const stablePublish = vi.fn();
const stableParent = { pubkey: 'p'.repeat(64) };

vi.mock('@nostrify/react', () => ({
  useNostr: () => ({ nostr: stableNostr }),
}));
vi.mock('@/hooks/useNostrPublish', () => ({
  useNostrPublish: () => ({ mutateAsync: stablePublish }),
}));
vi.mock('@/hooks/useParentSigner', () => ({
  useParentSigner: () => ({ user: stableParent, reason: undefined }),
}));

describe('useYouTubeDvm identity stability (no render loop)', () => {
  it('returns the same object across re-renders when inputs are unchanged', () => {
    const { result, rerender } = renderHook(() => useYouTubeDvm());
    const first = result.current;
    rerender();
    rerender();
    expect(result.current).toBe(first);
  });

  it('keeps search and watch referentially stable across re-renders', () => {
    const { result, rerender } = renderHook(() => useYouTubeDvm());
    const search = result.current.search;
    const watch = result.current.watch;
    rerender();
    expect(result.current.search).toBe(search);
    expect(result.current.watch).toBe(watch);
  });

  it('reports ready when a parent signer is present', () => {
    const { result } = renderHook(() => useYouTubeDvm());
    expect(result.current.ready).toBe(true);
  });
});
