import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

import {
  TeppDeniedError,
  resolveEnforcedConstruct,
  waitForConstruct,
  CONSTRUCT_UNAVAILABLE_MESSAGE,
} from './useKuboTeppGate';
import type { Construct } from '@/lib/tepp/types';

/**
 * KUBO-154 — fail-closed outbound gate when the construct is loading / absent /
 * error. The gate's React glue isn't unit-testable without renderHook (the
 * repo prefers pure-helper extraction, per KUBO-157), so we exercise the two
 * pure seams the hook delegates to: `resolveEnforcedConstruct` (the throw /
 * proceed decision) and `waitForConstruct` (the bounded cache poll).
 */

const KID = 'k'.repeat(64);
const PARENT = 'p'.repeat(64);

// A construct's internal shape doesn't matter for these tests — the gate only
// checks truthiness before handing it to the (separately-tested) evaluator.
const fakeConstruct = { kidPubkey: KID } as unknown as Construct;

describe('TeppDeniedError.constructUnavailable', () => {
  it('carries the construct-unavailable reason + kid-friendly copy', () => {
    const err = TeppDeniedError.constructUnavailable();
    expect(err).toBeInstanceOf(TeppDeniedError);
    expect(err).toBeInstanceOf(Error);
    expect(err.reason).toBe('construct-unavailable');
    expect(err.message).toBe(CONSTRUCT_UNAVAILABLE_MESSAGE);
    expect(err.verdict).toBeUndefined();
    expect(err.offendingReferences).toEqual([]);
  });
});

describe('resolveEnforcedConstruct (KUBO-154 fail-closed matrix)', () => {
  it('returns the construct when already loaded (no throw)', async () => {
    const result = await resolveEnforcedConstruct({
      construct: fakeConstruct,
      loading: false,
    });
    expect(result).toBe(fakeConstruct);
  });

  it('throws construct-unavailable when null + settled (not loading)', async () => {
    // Covers no-association / no-state-event / fetch-failed / decrypt-failed /
    // parent-logged-out — all settle to a null construct and must fail closed.
    await expect(
      resolveEnforcedConstruct({ construct: null, loading: false }),
    ).rejects.toMatchObject({ reason: 'construct-unavailable' });
  });

  it('throws when null + loading but no wait fn available', async () => {
    await expect(
      resolveEnforcedConstruct({ construct: null, loading: true }),
    ).rejects.toMatchObject({ reason: 'construct-unavailable' });
  });

  it('loading + wait yields a construct → returns it (bounded wait then proceed)', async () => {
    const wait = vi.fn().mockResolvedValue(fakeConstruct);
    const result = await resolveEnforcedConstruct({
      construct: null,
      loading: true,
      wait,
    });
    expect(wait).toHaveBeenCalledOnce();
    expect(result).toBe(fakeConstruct);
  });

  it('loading + wait yields null → throws construct-unavailable', async () => {
    const wait = vi.fn().mockResolvedValue(null);
    await expect(
      resolveEnforcedConstruct({ construct: null, loading: true, wait }),
    ).rejects.toMatchObject({ reason: 'construct-unavailable' });
    expect(wait).toHaveBeenCalledOnce();
  });

  it('does NOT wait when a construct is already present', async () => {
    const wait = vi.fn().mockResolvedValue(null);
    const result = await resolveEnforcedConstruct({
      construct: fakeConstruct,
      loading: true,
      wait,
    });
    expect(result).toBe(fakeConstruct);
    expect(wait).not.toHaveBeenCalled();
  });
});

describe('waitForConstruct (bounded cache poll)', () => {
  function seed(qc: QueryClient, data: unknown) {
    qc.setQueryData(['kubo-tepp-construct', KID, PARENT], data);
  }

  it('returns immediately when the cache already holds a loaded construct', async () => {
    const qc = new QueryClient();
    seed(qc, { construct: fakeConstruct });
    const start = Date.now();
    const result = await waitForConstruct(qc, KID, PARENT, 5000, 50);
    expect(result).toBe(fakeConstruct);
    expect(Date.now() - start).toBeLessThan(200);
  });

  it('returns null immediately when the cache holds a settled null construct', async () => {
    const qc = new QueryClient();
    seed(qc, { construct: null });
    const start = Date.now();
    const result = await waitForConstruct(qc, KID, PARENT, 5000, 50);
    expect(result).toBeNull();
    expect(Date.now() - start).toBeLessThan(200);
  });

  it('resolves to a construct that appears mid-wait', async () => {
    const qc = new QueryClient();
    // No data yet (query truly in flight — getQueryData returns undefined).
    setTimeout(() => seed(qc, { construct: fakeConstruct }), 120);
    const result = await waitForConstruct(qc, KID, PARENT, 2000, 40);
    expect(result).toBe(fakeConstruct);
  });

  it('times out to null when the construct never arrives', async () => {
    const qc = new QueryClient();
    const result = await waitForConstruct(qc, KID, PARENT, 200, 40);
    expect(result).toBeNull();
  });
});
