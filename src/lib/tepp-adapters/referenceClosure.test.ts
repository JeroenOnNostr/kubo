import { describe, expect, it, vi } from 'vitest';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { pendingReferenceIds, prefetchReferenceClosure } from './referenceClosure';

const ID = (n: number) => n.toString(16).padStart(64, '0');

function note(id: string, opts: { eTags?: string[]; qTags?: string[] } = {}): NostrEvent {
  const tags: string[][] = [];
  for (const e of opts.eTags ?? []) tags.push(['e', e]);
  for (const q of opts.qTags ?? []) tags.push(['q', q]);
  return {
    id,
    pubkey: 'a'.repeat(64),
    kind: 1,
    content: '',
    tags,
    created_at: 1,
    sig: '0'.repeat(128),
  };
}

/** A fake pool that returns events by id from a fixed set, recording calls. */
function fakePool(known: NostrEvent[]) {
  const byId = new Map(known.map((e) => [e.id, e]));
  const calls: string[][] = [];
  const query = vi.fn(async (filters: NostrFilter[]) => {
    const ids = (filters[0]?.ids ?? []) as string[];
    calls.push(ids);
    return ids.map((id) => byId.get(id)).filter((e): e is NostrEvent => !!e);
  });
  return { query, calls };
}

describe('pendingReferenceIds', () => {
  it('collects e- and q-tag references not already cached', () => {
    const ev = note(ID(1), { eTags: [ID(2)], qTags: [ID(3)] });
    const ids = pendingReferenceIds([ev], new Map());
    expect(ids).toEqual(new Set([ID(2), ID(3)]));
  });

  it('excludes ids already present in the cache', () => {
    const ev = note(ID(1), { eTags: [ID(2), ID(3)] });
    const have = new Map([[ID(2), note(ID(2))]]);
    expect(pendingReferenceIds([ev], have)).toEqual(new Set([ID(3)]));
  });

  it('returns empty for events with no references', () => {
    expect(pendingReferenceIds([note(ID(1))], new Map()).size).toBe(0);
  });
});

describe('prefetchReferenceClosure', () => {
  it('fetches direct references in a single batch', async () => {
    const parent = note(ID(2));
    const seed = note(ID(1), { eTags: [ID(2)] });
    const pool = fakePool([parent]);

    const { cache, missing } = await prefetchReferenceClosure([seed], pool.query);

    expect(cache.get(ID(1))).toBe(seed);
    expect(cache.get(ID(2))).toBe(parent);
    expect(missing.size).toBe(0);
    expect(pool.calls.length).toBe(1);
    expect(pool.calls[0].sort()).toEqual([ID(2)]);
  });

  it('walks transitive references across hops', async () => {
    const grandparent = note(ID(3));
    const parent = note(ID(2), { eTags: [ID(3)] });
    const seed = note(ID(1), { eTags: [ID(2)] });
    const pool = fakePool([parent, grandparent]);

    const { cache } = await prefetchReferenceClosure([seed], pool.query, { maxDepth: 4 });

    expect(cache.get(ID(3))).toBe(grandparent);
    // hop 1 fetches id2, hop 2 fetches id3.
    expect(pool.calls.length).toBe(2);
  });

  it('stops at maxDepth', async () => {
    const parent = note(ID(2), { eTags: [ID(3)] });
    const seed = note(ID(1), { eTags: [ID(2)] });
    const pool = fakePool([parent, note(ID(3))]);

    const { cache } = await prefetchReferenceClosure([seed], pool.query, { maxDepth: 1 });

    expect(cache.has(ID(2))).toBe(true);
    expect(cache.has(ID(3))).toBe(false); // would need a 2nd hop
    expect(pool.calls.length).toBe(1);
  });

  it('records genuinely missing references without re-querying them', async () => {
    const seed = note(ID(1), { eTags: [ID(9)] });
    const pool = fakePool([]); // relay returns nothing for id9

    const { cache, missing } = await prefetchReferenceClosure([seed], pool.query, { maxDepth: 4 });

    expect(cache.has(ID(9))).toBe(false);
    expect(missing.has(ID(9))).toBe(true);
    // Only one query — a missing id is not retried across hops.
    expect(pool.calls.length).toBe(1);
  });

  it('fails open (marks missing, stops) when the pool throws', async () => {
    const seed = note(ID(1), { eTags: [ID(2)] });
    const query = vi.fn(async () => {
      throw new Error('relay down');
    });

    const { cache, missing } = await prefetchReferenceClosure([seed], query);

    expect(cache.get(ID(1))).toBe(seed);
    expect(cache.has(ID(2))).toBe(false);
    expect(missing.has(ID(2))).toBe(true);
  });

  it('reuses a passed-in cache', async () => {
    const parent = note(ID(2));
    const seed = note(ID(1), { eTags: [ID(2)] });
    const existing = new Map([[ID(2), parent]]);
    const pool = fakePool([parent]);

    const { cache } = await prefetchReferenceClosure([seed], pool.query, { cache: existing });

    expect(cache).toBe(existing);
    // id2 already cached → no fetch needed.
    expect(pool.calls.length).toBe(0);
  });
});
