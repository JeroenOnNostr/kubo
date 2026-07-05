import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useTabletMode } from './useTabletMode';

// Drive each input independently so we can exercise the platform/size/per-kid
// matrix without a real matchMedia or Capacitor.
const mockNative = vi.fn(() => false);
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => mockNative() },
}));

const mockLarge = vi.fn(() => false);
vi.mock('@/hooks/useIsLargeViewport', () => ({
  useIsLargeViewport: () => mockLarge(),
}));

const mockUser = vi.fn<() => { user: { pubkey: string } | undefined }>(() => ({
  user: undefined,
}));
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => mockUser(),
}));

const mockKidSettings = vi.fn(() => ({ tabletMode: false }));
vi.mock('@/hooks/useKuboFamily', () => ({
  useKuboFamily: () => ({}),
  getKidSettings: () => mockKidSettings(),
}));

describe('useTabletMode', () => {
  beforeEach(() => {
    mockNative.mockReturnValue(false);
    mockLarge.mockReturnValue(false);
    mockUser.mockReturnValue({ user: undefined });
    mockKidSettings.mockReturnValue({ tabletMode: false });
  });

  it('forces tablet mode on large web, even with no kid and per-kid off', () => {
    mockNative.mockReturnValue(false); // web
    mockLarge.mockReturnValue(true);   // desktop/tablet size
    const { result } = renderHook(() => useTabletMode());
    expect(result.current).toBe(true);
  });

  it('does NOT force tablet mode on native at large size (per-kid off wins)', () => {
    mockNative.mockReturnValue(true);  // native
    mockLarge.mockReturnValue(true);
    mockUser.mockReturnValue({ user: { pubkey: 'abc' } });
    mockKidSettings.mockReturnValue({ tabletMode: false });
    const { result } = renderHook(() => useTabletMode());
    expect(result.current).toBe(false);
  });

  it('honors the per-kid setting on mobile web (small viewport)', () => {
    mockNative.mockReturnValue(false); // web
    mockLarge.mockReturnValue(false);  // phone-size browser
    mockUser.mockReturnValue({ user: { pubkey: 'abc' } });
    mockKidSettings.mockReturnValue({ tabletMode: true });
    const { result } = renderHook(() => useTabletMode());
    expect(result.current).toBe(true);
  });
});
