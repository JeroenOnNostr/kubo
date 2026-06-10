import { describe, expect, it, vi } from 'vitest'
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify'

import {
  prefetchReferenceClosure,
  pendingReferenceIds,
  MAX_CLOSURE_IDS,
  DEFAULT_CLOSURE_DEPTH,
} from './referenceClosure'

/**
 * KUBO-174 item 4 — reference-cache interplay gaps not in referenceClosure.test.ts:
 *   - the MAX_CLOSURE_IDS circuit breaker (flooding cap) — a hostile thread that
 *     keeps producing fresh references must not be walked unbounded; the cap
 *     fails the overflow open (resolved-absent), not pending-forever.
 *   - closure prefetch dedupe across a batch that re-references the same ids
 *     (the dedupe the feed-filter cache leans on so each id is fetched once).
 *   - the pending-never-cached invariant at the pure layer: a missing reference
 *     ends up in `missing`, never in `cache`.
 */

const ID = (n: number) => n.toString(16).padStart(64, '0')

function note(id: string, eTags: string[] = []): NostrEvent {
  return {
    id,
    pubkey: 'a'.repeat(64),
    kind: 1,
    content: '',
    tags: eTags.map((e) => ['e', e]),
    created_at: 1,
    sig: '0'.repeat(128),
  }
}

/** Pool that synthesises a fresh child for every requested id (infinite frontier). */
function expandingPool() {
  const calls: string[][] = []
  let nextId = 1_000_000
  const query = vi.fn(async (filters: NostrFilter[]) => {
    const ids = (filters[0]?.ids ?? []) as string[]
    calls.push(ids)
    // Each requested id resolves to an event that references TWO brand-new ids,
    // so the frontier keeps growing — exactly the flood the cap must bound.
    return ids.map((id) => note(id, [ID(nextId++), ID(nextId++)]))
  })
  return { query, calls }
}

function fixedPool(known: NostrEvent[]) {
  const byId = new Map(known.map((e) => [e.id, e]))
  const calls: string[][] = []
  const query = vi.fn(async (filters: NostrFilter[]) => {
    const ids = (filters[0]?.ids ?? []) as string[]
    calls.push(ids)
    return ids.map((id) => byId.get(id)).filter((e): e is NostrEvent => !!e)
  })
  return { query, calls }
}

describe('prefetchReferenceClosure — MAX_CLOSURE_IDS flood cap', () => {
  it('caps total requested ids at MAX_CLOSURE_IDS against an infinite frontier', async () => {
    const pool = expandingPool()
    const seed = note(ID(1), [ID(2), ID(3)])
    await prefetchReferenceClosure([seed], pool.query, {
      // Large depth so the cap, not the depth, is what stops the walk.
      maxDepth: 1000,
    })
    const totalRequested = pool.calls.reduce((sum, ids) => sum + ids.length, 0)
    expect(totalRequested).toBeLessThanOrEqual(MAX_CLOSURE_IDS)
  })

  it('the overflow ids fail OPEN (recorded missing), not left forever-pending', async () => {
    const pool = expandingPool()
    const seed = note(ID(1), [ID(2), ID(3)])
    const { missing } = await prefetchReferenceClosure([seed], pool.query, {
      maxDepth: 1000,
    })
    // When the next hop would exceed the cap, every wanted id of that hop is
    // marked missing (resolved-absent) so the evaluator treats them as fetched.
    expect(missing.size).toBeGreaterThan(0)
  })
})

describe('prefetchReferenceClosure — batch dedupe', () => {
  it('fetches a shared reference once across many seeds in the same batch', async () => {
    const shared = ID(100)
    const pool = fixedPool([note(shared)])
    const seeds = [note(ID(1), [shared]), note(ID(2), [shared]), note(ID(3), [shared])]
    await prefetchReferenceClosure(seeds, pool.query, { maxDepth: DEFAULT_CLOSURE_DEPTH })
    // One query, and the shared id appears exactly once in its id list.
    const sharedRequests = pool.calls.flat().filter((id) => id === shared)
    expect(sharedRequests).toHaveLength(1)
  })

  it('a missing reference lands in `missing`, never in `cache` (pending-never-cached)', async () => {
    const pool = fixedPool([]) // relay returns nothing for the wanted id
    const seed = note(ID(1), [ID(2)])
    const { cache, missing } = await prefetchReferenceClosure([seed], pool.query, {
      maxDepth: DEFAULT_CLOSURE_DEPTH,
    })
    expect(cache.has(ID(2))).toBe(false)
    expect(missing.has(ID(2))).toBe(true)
    // The seed itself is always cached so intra-batch references resolve.
    expect(cache.has(ID(1))).toBe(true)
  })
})

describe('pendingReferenceIds — interplay with the cache', () => {
  it('does not re-list an id already in the cache (so a warm cache short-circuits)', () => {
    const cache = new Map<string, NostrEvent>([[ID(2), note(ID(2))]])
    const want = pendingReferenceIds([note(ID(1), [ID(2), ID(3)])], cache)
    expect(want.has(ID(2))).toBe(false)
    expect(want.has(ID(3))).toBe(true)
  })
})
