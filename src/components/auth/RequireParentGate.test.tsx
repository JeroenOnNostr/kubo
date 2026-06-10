import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { RequireParentGate } from './RequireParentGate';
import {
  isParentUnlocked,
  unlockParent,
  lockParent,
  __resetParentUnlockStoreForTests,
} from '@/lib/parentUnlockStore';

/**
 * KUBO-153 — the route guard around /parent/*. We assert the three behaviours
 * that protect the parent pages: locked → PIN dialog (not the page); unlocked →
 * the page renders; and the two non-timer clear-triggers (navigation-out
 * unmount, app background) re-lock so a later return re-prompts.
 *
 * The ParentGateDialog itself (PIN entry, setup flow, cooldown copy) is
 * exercised through the pure store + hook tests; here we only need it to mount
 * without throwing, so its secureStorage/nav deps are stubbed minimally.
 */
vi.mock('@/hooks/useParentGatePin', () => ({
  useParentGatePin: () => ({
    isSet: true,
    setPin: vi.fn(),
    verifyPin: vi.fn().mockResolvedValue(false),
    clearPin: vi.fn(),
    cooldownMs: 0,
  }),
}));

function renderGuard(initialPath = '/parent/kid-settings') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<RequireParentGate />}>
          <Route
            path="/parent/kid-settings"
            element={<div data-testid="protected">SECRET PARENT PAGE</div>}
          />
          <Route
            path="/parent/home"
            element={<div data-testid="protected-home">PARENT HOME</div>}
          />
        </Route>
        <Route path="/kid" element={<div data-testid="kid">KID APP</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequireParentGate (KUBO-153)', () => {
  beforeEach(() => {
    __resetParentUnlockStoreForTests();
  });
  afterEach(() => {
    __resetParentUnlockStoreForTests();
  });

  it('renders the PIN gate (not the page) when locked', () => {
    const { queryByTestId, getByText } = renderGuard();
    expect(queryByTestId('protected')).toBeNull();
    // The dialog title for an existing PIN.
    expect(getByText('Parent passcode')).toBeInTheDocument();
  });

  it('renders the protected page once unlocked', () => {
    const { queryByTestId } = renderGuard();
    expect(queryByTestId('protected')).toBeNull();

    act(() => {
      unlockParent();
    });
    expect(queryByTestId('protected')).not.toBeNull();
  });

  it('clears the unlock on unmount (navigation out of /parent/*)', () => {
    act(() => {
      unlockParent();
    });
    const { unmount } = renderGuard();
    expect(isParentUnlocked()).toBe(true);
    unmount();
    expect(isParentUnlocked()).toBe(false);
  });

  it('clears the unlock when the app is backgrounded (visibilitychange)', () => {
    act(() => {
      unlockParent();
    });
    renderGuard();
    expect(isParentUnlocked()).toBe(true);

    act(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(isParentUnlocked()).toBe(false);

    // restore
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });

  it('re-shows the gate after a lock while still on a /parent route', () => {
    act(() => {
      unlockParent();
    });
    const { queryByTestId } = renderGuard();
    expect(queryByTestId('protected')).not.toBeNull();

    act(() => {
      lockParent();
    });
    expect(queryByTestId('protected')).toBeNull();
  });
});
