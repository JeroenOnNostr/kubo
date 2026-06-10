import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { BlockedContent } from './BlockedContent';
import { isAuthorBlocked, resolvePostDetailGate } from './blockedContentGate';

/**
 * KUBO-163 — read-side gating logic. The render-GATE decisions are extracted as
 * pure helpers (the full pages are hook-heavy); these tests pin the exact
 * matrices that guarantee denied content NEVER paints.
 */
describe('resolvePostDetailGate (KUBO-163 deep-link render gate)', () => {
  it('not enforced → always pass (parent surface, no gating)', () => {
    // Even an unsettled / denied verdict passes when TEPP isn't enforced.
    expect(resolvePostDetailGate(false, false, false)).toBe('pass');
    expect(resolvePostDetailGate(false, true, false)).toBe('pass');
    expect(resolvePostDetailGate(false, true, true)).toBe('pass');
  });

  it('enforced + verdict unsettled → skeleton, NEVER content (no flash)', () => {
    // The headline fix: while the construct/closure resolves (or
    // construct-unavailable, KUBO-154), show the skeleton — not the post.
    expect(resolvePostDetailGate(true, false, true)).toBe('skeleton');
    expect(resolvePostDetailGate(true, false, false)).toBe('skeleton');
  });

  it('enforced + settled + visible → pass (render the real content)', () => {
    expect(resolvePostDetailGate(true, true, true)).toBe('pass');
  });

  it('enforced + settled + denied → blocked card', () => {
    expect(resolvePostDetailGate(true, true, false)).toBe('blocked');
  });
});

describe('isAuthorBlocked (KUBO-163 comments + profile)', () => {
  it('blocks only when enforced AND the author verdict is a concrete deny', () => {
    expect(isAuthorBlocked(true, false)).toBe(true);
  });

  it('never blocks when not enforced (parent surfaces / non-enforced kids)', () => {
    expect(isAuthorBlocked(false, false)).toBe(false);
    expect(isAuthorBlocked(false, true)).toBe(false);
  });

  it('fails open while the verdict is unsettled (visible pass-through)', () => {
    // useKuboTeppEvaluateAuthor returns visible:true while loading/no-construct.
    expect(isAuthorBlocked(true, true)).toBe(false);
  });
});

describe('BlockedContent card', () => {
  it('renders the default kid-friendly copy and a stable test marker', () => {
    const { container } = render(<BlockedContent />);
    expect(
      container.querySelector('[data-kubo-tepp-blocked]'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/set aside/i),
    ).toBeInTheDocument();
  });

  it('renders an overridden message', () => {
    render(<BlockedContent message="custom blocked copy" />);
    expect(screen.getByText('custom blocked copy')).toBeInTheDocument();
  });
});
