import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';

import { NextPostFAB } from './NextPostFAB';

/**
 * KUBO-063 FAB behavior: tap fires onAdvance, starts a 3s cooldown that
 * disables the button, and scrolls to the resolved post element. The
 * cooldown is the anti-doomscroll brake — without it the FAB is just a
 * keyboard shortcut for the same infinite scroll it was meant to replace.
 */
vi.mock('@/lib/haptics', () => ({
  selectionChanged: vi.fn(),
}));

describe('NextPostFAB (KUBO-063)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom doesn't implement window.scrollTo; stub it so the tap handler
    // doesn't throw when the cap advances.
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires onAdvance and becomes disabled during cooldown', () => {
    const onAdvance = vi.fn();
    const { getByRole } = render(
      <NextPostFAB
        onAdvance={onAdvance}
        unlockedCount={1}
        getPostElement={() => null}
      />,
    );
    const btn = getByRole('button', { name: 'Next post' });

    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onAdvance).toHaveBeenCalledTimes(1);
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('aria-busy')).toBe('true');

    // Tapping again during cooldown does nothing.
    fireEvent.click(btn);
    expect(onAdvance).toHaveBeenCalledTimes(1);

    // After the cooldown window the button re-enables and fires again.
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onAdvance).toHaveBeenCalledTimes(2);
  });

  it('renders the cooldown ring only while cooling down', () => {
    const { getByRole, container } = render(
      <NextPostFAB
        onAdvance={vi.fn()}
        unlockedCount={1}
        getPostElement={() => null}
      />,
    );
    // The ChevronDown icon is itself an SVG, so we match on the ring's
    // <circle> (the icon has only a <path>) to isolate the cooldown ring.
    expect(container.querySelector('circle')).toBeNull();

    fireEvent.click(getByRole('button', { name: 'Next post' }));
    expect(container.querySelector('circle')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(container.querySelector('circle')).toBeNull();
  });

  it('scrolls to the resolved post element after tap', () => {
    const fakeEl = {
      getBoundingClientRect: () => ({ top: 500 }),
    } as unknown as HTMLElement;
    const getPostElement = vi.fn().mockReturnValue(fakeEl);
    const scrollSpy = vi.fn();
    window.scrollTo = scrollSpy as unknown as typeof window.scrollTo;

    const { getByRole } = render(
      <NextPostFAB
        onAdvance={vi.fn()}
        unlockedCount={2}
        getPostElement={getPostElement}
      />,
    );
    fireEvent.click(getByRole('button', { name: 'Next post' }));

    // Double-rAF delays the measurement — flush two frames.
    act(() => {
      vi.advanceTimersByTime(50);
    });
    // jsdom's rAF is a setImmediate-like; run pending microtasks too.
    act(() => {
      vi.runOnlyPendingTimers();
    });

    // The FAB should have asked for idx = unlockedCount — the FIRST of the
    // newly-unlocked posts (KidHomePage advances by a full row per tap, so we
    // land on the top of the new row rather than its last tile).
    expect(getPostElement).toHaveBeenCalledWith(2);
    // Scroll target = top + window.scrollY - 12 = 500 + 0 - 12 = 488.
    expect(scrollSpy).toHaveBeenCalledWith({ top: 488, behavior: 'smooth' });
  });

  it('silently no-ops when the target post element is not yet rendered', () => {
    const scrollSpy = vi.fn();
    window.scrollTo = scrollSpy as unknown as typeof window.scrollTo;

    const { getByRole } = render(
      <NextPostFAB
        onAdvance={vi.fn()}
        unlockedCount={10}
        getPostElement={() => null}
      />,
    );
    fireEvent.click(getByRole('button', { name: 'Next post' }));
    act(() => {
      vi.advanceTimersByTime(50);
      vi.runOnlyPendingTimers();
    });
    expect(scrollSpy).not.toHaveBeenCalled();
  });
});
