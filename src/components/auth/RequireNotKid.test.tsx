import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { RequireNotKid } from './RequireNotKid';
import type { KuboKid } from '@/hooks/useKuboFamily';

/**
 * KUBO-158 — Layer 2 backstop. RequireNotKid wraps the MainLayout route group:
 * when the active session is a kid in the family, every guarded route redirects
 * to /kid (covers raw URL entry on web). Parents / non-kid / pre-load sessions
 * fall through to the page.
 *
 * The kid-vs-not predicate is `useSelectedKid()` — mocked here so we can drive
 * each case without standing up the login + family stores.
 */

const selectedKid = vi.fn((): KuboKid | null => null);
vi.mock('@/hooks/useSelectedKid', () => ({
  useSelectedKid: () => selectedKid(),
}));

function renderGuard(initialPath = '/t/cats') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<RequireNotKid />}>
          <Route path="/t/:tag" element={<div data-testid="main">MAIN LAYOUT PAGE</div>} />
          <Route path="/search" element={<div data-testid="main">SEARCH</div>} />
        </Route>
        <Route path="/kid" element={<div data-testid="kid">KID HOME</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequireNotKid (KUBO-158)', () => {
  beforeEach(() => {
    selectedKid.mockReset();
    selectedKid.mockReturnValue(null);
  });

  it('redirects a kid session to /kid (raw URL entry blocked)', () => {
    selectedKid.mockReturnValue({ pubkey: 'kid-pk', displayName: 'Kid' } as KuboKid);
    const { queryByTestId } = renderGuard('/t/cats');
    expect(queryByTestId('main')).toBeNull();
    expect(queryByTestId('kid')).not.toBeNull();
  });

  it('redirects a kid session on /search too', () => {
    selectedKid.mockReturnValue({ pubkey: 'kid-pk', displayName: 'Kid' } as KuboKid);
    const { queryByTestId } = renderGuard('/search');
    expect(queryByTestId('main')).toBeNull();
    expect(queryByTestId('kid')).not.toBeNull();
  });

  it('lets a parent / non-kid session render the page', () => {
    selectedKid.mockReturnValue(null);
    const { queryByTestId } = renderGuard('/t/cats');
    expect(queryByTestId('main')).not.toBeNull();
    expect(queryByTestId('kid')).toBeNull();
  });

  it('lets a session through before family loads (useSelectedKid null)', () => {
    selectedKid.mockReturnValue(null);
    const { queryByTestId } = renderGuard('/search');
    expect(queryByTestId('main')).not.toBeNull();
    expect(queryByTestId('kid')).toBeNull();
  });
});
