import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { Event as NostrToolsEvent } from 'nostr-tools/core';

import {
  TeppDeniedError,
  resolveEnforcedConstruct,
  waitForConstruct,
  computeFollowListDelta,
  buildDeltaEventForRecordList,
  readCachedFollowPubkeys,
  CONSTRUCT_UNAVAILABLE_MESSAGE,
} from './useKuboTeppGate';
import { evaluateEvent } from '@/lib/tepp/evaluate';
import { KIND_PERMISSION_VIEW_NPUB_A } from '@/lib/tepp/kinds';
import type { Construct, ConstructEntry } from '@/lib/tepp/types';
import type { NostrEvent } from '@nostrify/nostrify';

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

/**
 * KUBO-164 — kind-3 delta evaluation. The gate must not hard-deny the whole
 * follow list because one stale, now-unadmitted follow lingers in it. It
 * evaluates only the entries NEWLY added versus the kid's previous list.
 */

const ADMITTED = 'd'.repeat(64); // admitted at view threshold in the construct
const STALE = 'e'.repeat(64); // formerly-followed, NOT in the construct anymore
const FRESH_DENY = 'f'.repeat(64); // newly added but not admitted

function viewEntry(pubkey: string): ConstructEntry {
  return {
    kind: KIND_PERMISSION_VIEW_NPUB_A,
    sourceEventId: `view-${pubkey.slice(0, 8)}`,
    source: 'direct',
    items: [{ pubkey }],
    restrictions: [],
    monitorRelays: [],
  };
}

const deltaConstruct: Construct = {
  subject: KID,
  guardians: [PARENT],
  // Only ADMITTED is granted view trust. STALE / FRESH_DENY are unadmitted.
  entries: [viewEntry(ADMITTED)],
  blacklist: undefined,
  extensionTraces: [],
  inertAuditFindings: [],
};

function kind3(pubkeys: string[]): NostrEvent {
  return {
    id: '0'.repeat(64),
    sig: '0'.repeat(128),
    pubkey: KID,
    kind: 3,
    content: '',
    tags: pubkeys.map((pk) => ['p', pk]),
    created_at: 1_700_000_000,
  };
}

/** Mirror the gate's record-list path: build the delta event, evaluate at view. */
function evaluateFollowList(next: NostrEvent, prev: string[] | null): string {
  const delta = buildDeltaEventForRecordList(next, prev);
  return evaluateEvent(
    delta as unknown as NostrToolsEvent,
    deltaConstruct,
    'incoming',
  ).result;
}

describe('computeFollowListDelta (KUBO-164 pure helper)', () => {
  it('treats every entry as added when there is no previous list', () => {
    expect(computeFollowListDelta(null, [ADMITTED, STALE])).toEqual({
      added: [ADMITTED, STALE],
    });
  });

  it('returns only the entries not present in the previous list', () => {
    expect(computeFollowListDelta([STALE], [STALE, ADMITTED])).toEqual({
      added: [ADMITTED],
    });
  });

  it('returns no additions for a removals-only change', () => {
    expect(computeFollowListDelta([STALE, ADMITTED], [ADMITTED])).toEqual({
      added: [],
    });
  });

  it('dedups and ignores empty pubkeys', () => {
    expect(computeFollowListDelta([], [ADMITTED, ADMITTED, ''])).toEqual({
      added: [ADMITTED],
    });
  });
});

describe('buildDeltaEventForRecordList (KUBO-164)', () => {
  it('keeps only the added p-tags and preserves non-p tags', () => {
    const draft: NostrEvent = {
      ...kind3([STALE, ADMITTED]),
      tags: [['p', STALE], ['p', ADMITTED], ['client', 'kubo']],
    };
    const delta = buildDeltaEventForRecordList(draft, [STALE]);
    expect(delta.tags).toEqual([['client', 'kubo'], ['p', ADMITTED]]);
  });
});

describe('kind-3 delta evaluation end-to-end (KUBO-164)', () => {
  it('permits a list with a stale unadmitted follow + a newly-added admitted follow', () => {
    // prev had STALE (now unadmitted); next adds ADMITTED. Only ADMITTED is
    // evaluated → permit, even though STALE is unadmitted and still in the list.
    expect(evaluateFollowList(kind3([STALE, ADMITTED]), [STALE])).not.toBe('deny');
  });

  it('denies when the newly-added follow is itself unadmitted', () => {
    expect(evaluateFollowList(kind3([STALE, FRESH_DENY]), [STALE])).toBe('deny');
  });

  it('evaluates every entry when there is no previous list (denies an unadmitted one)', () => {
    expect(evaluateFollowList(kind3([ADMITTED, STALE]), null)).toBe('deny');
  });

  it('permits a removals-only publish (no added entries to evaluate)', () => {
    // prev had ADMITTED + STALE; next drops STALE. Nothing added → permit.
    expect(evaluateFollowList(kind3([ADMITTED]), [ADMITTED, STALE])).not.toBe('deny');
  });
});

describe('readCachedFollowPubkeys (KUBO-164)', () => {
  it('returns the cached follow pubkeys when present', () => {
    const qc = new QueryClient();
    qc.setQueryData(['follow-list', KID], { event: null, pubkeys: [ADMITTED, STALE] });
    expect(readCachedFollowPubkeys(qc, KID)).toEqual([ADMITTED, STALE]);
  });

  it('returns null when no follow list is cached', () => {
    const qc = new QueryClient();
    expect(readCachedFollowPubkeys(qc, KID)).toBeNull();
  });
});
