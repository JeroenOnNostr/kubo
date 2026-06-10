import { describe, expect, it } from 'vitest';

import { pickConstructWithFallback } from './useConstruct';
import type { Construct } from '@/lib/tepp/types';

/**
 * KUBO-155 — last-known-good fallback: brief relay flaps that settle the
 * construct query to a transient null must not blank the kid feed. The pure
 * `pickConstructWithFallback` serves a cached construct across transient
 * failures, but NOT across decrypt-failed (stable key/format problem).
 */

const A = { id: 'a' } as unknown as Construct;
const LKG = { id: 'lkg' } as unknown as Construct;
const lkgEntry = { construct: LKG, fingerprint: 'fp-lkg' };

describe('pickConstructWithFallback (KUBO-155)', () => {
  it('serves the fresh construct when present (no fallback)', () => {
    const out = pickConstructWithFallback(
      { construct: A, fingerprint: 'fp-a', reason: undefined },
      lkgEntry,
    );
    expect(out.construct).toBe(A);
    expect(out.fingerprint).toBe('fp-a');
    expect(out.usedFallback).toBe(false);
  });

  it('serves last-known-good on a transient null (fetch-failed flap)', () => {
    const out = pickConstructWithFallback(
      { construct: null, fingerprint: null, reason: 'fetch-failed' },
      lkgEntry,
    );
    expect(out.construct).toBe(LKG);
    expect(out.fingerprint).toBe('fp-lkg');
    expect(out.usedFallback).toBe(true);
  });

  it('serves last-known-good on no-association / no-state-event', () => {
    for (const reason of ['no-association', 'no-state-event']) {
      const out = pickConstructWithFallback(
        { construct: null, fingerprint: null, reason },
        lkgEntry,
      );
      expect(out.construct).toBe(LKG);
      expect(out.usedFallback).toBe(true);
    }
  });

  it('does NOT serve fallback on decrypt-failed (stable problem, not a flap)', () => {
    const out = pickConstructWithFallback(
      { construct: null, fingerprint: null, reason: 'decrypt-failed' },
      lkgEntry,
    );
    expect(out.construct).toBeNull();
    expect(out.usedFallback).toBe(false);
  });

  it('serves null when there is no cached last-known-good', () => {
    const out = pickConstructWithFallback(
      { construct: null, fingerprint: null, reason: 'fetch-failed' },
      undefined,
    );
    expect(out.construct).toBeNull();
    expect(out.usedFallback).toBe(false);
  });
});
