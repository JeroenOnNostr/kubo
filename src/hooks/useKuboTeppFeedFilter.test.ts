import { describe, expect, it } from 'vitest';

import { resolveFeedFilterMode } from './useKuboTeppFeedFilter';

/**
 * KUBO-155 — render-side feed filter must fail closed. Previously the filter
 * returned PASS (show everything) whenever the construct was null for ANY
 * reason, so a relay simply withholding the state event disabled read filtering
 * entirely. Now: PASS only when NOT enforced; enforced + null construct →
 * hide-all.
 */
describe('resolveFeedFilterMode (KUBO-155)', () => {
  it('not enforced → pass (no filtering, show everything)', () => {
    expect(resolveFeedFilterMode(false, false, false)).toBe('pass');
    expect(resolveFeedFilterMode(false, true, true)).toBe('pass');
  });

  it('enforced + null construct → hide-all (fail-closed, NOT pass)', () => {
    expect(resolveFeedFilterMode(true, false, false)).toBe('hide-all');
  });

  it('enforced + construct but no fingerprint → hide-all', () => {
    expect(resolveFeedFilterMode(true, true, false)).toBe('hide-all');
  });

  it('enforced + construct + fingerprint → evaluate per event', () => {
    expect(resolveFeedFilterMode(true, true, true)).toBe('evaluate');
  });
});
