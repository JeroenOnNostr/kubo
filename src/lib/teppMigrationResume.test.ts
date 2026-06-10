import { describe, expect, it } from 'vitest'

import {
  buildMigrationPlan,
  markAcked,
  planFullyAcked,
  type TeppMigrationPlan,
} from './teppMigration'
import type { KuboFamily } from '@/hooks/useKuboFamily'

/**
 * KUBO-174 item 7 — `runMigration` resume invariants.
 *
 * `runMigration`, `persistPlan`, and `signMigrationTemplate` in
 * `useTeppMigration.ts` are module-private and not exported, and the runner is a
 * React-effect-driven loop over `useKuboFamily`/`useNostr`/`useFollowPacks`.
 * Unit-testing the function body would require either exporting it (a production
 * change, forbidden for this task) or mocking the entire hook graph. Per the
 * plan's fallback, this file pins the *plan-walk algebra* the runner is built on
 * via the exported pure helpers (`buildMigrationPlan` / `markAcked` /
 * `planFullyAcked`) and a faithful re-implementation of the runner's
 * "walk in order, persist after each ack, halt on failure, resume from the first
 * un-acked step" contract. What it canNOT cover (effect wiring, the live
 * persistPlan→readLatest merge against the Tauri store, two-real-tabs) is listed
 * in the KUBO-174 report for the KUBO-145 browser walkthrough.
 */

const PARENT = 'p'.repeat(64)
const KID_A = 'a'.repeat(64)
const KID_B = 'b'.repeat(64)

function makeFamily(kids = [{ pubkey: KID_A, displayName: 'Kid A' }]): KuboFamily {
  return { parentPubkey: PARENT, parentDisplayName: 'Parent', kids }
}

/**
 * Faithful model of `runMigration`'s per-step loop: walk steps in `order`,
 * publish (here: invoke `publish(order)`), mark acked + persist on success,
 * and HALT this kid on failure (resume next boot). `crashAfter` simulates a
 * process death right after a given (kid, order) ack persists. Returns the
 * persisted plan as it would survive the crash.
 */
function walkUntilCrash(
  plan: TeppMigrationPlan,
  opts: {
    crashAfterOrder?: number
    failAtOrder?: number
    skipOrder?: (order: number) => boolean
    persisted: TeppMigrationPlan[]
  },
): TeppMigrationPlan {
  let current = plan
  const ordered = [...current.steps].sort((a, b) => a.order - b.order)
  for (const step of ordered) {
    const live = current.steps.find((s) => s.id === step.id)!
    if (live.acked) continue
    if (opts.skipOrder?.(step.order)) {
      // Skipped (e.g. assoc deferred: kid not logged in) — NOT marked acked, so
      // a later run retriggers it. Mirrors signMigrationTemplate returning null.
      continue
    }
    if (opts.failAtOrder === step.order) {
      // Publish failed → halt; the plan persisted so far is what survives.
      return current
    }
    current = markAcked(current, step.id)
    opts.persisted.push(current) // persistPlan after each ack
    if (opts.crashAfterOrder === step.order) {
      return current
    }
  }
  return current
}

describe('runMigration resume — order boundaries', () => {
  it('a fresh plan has 6 un-acked steps for one kid, none acked', () => {
    const plan = buildMigrationPlan(makeFamily())
    expect(plan.steps).toHaveLength(6)
    expect(plan.steps.every((s) => !s.acked)).toBe(true)
  })

  for (const boundary of [1, 2, 3, 4, 5] as const) {
    it(`crash after order ${boundary} resumes from the next un-acked step`, () => {
      const persisted: TeppMigrationPlan[] = []
      const fresh = buildMigrationPlan(makeFamily())
      const survived = walkUntilCrash(fresh, { crashAfterOrder: boundary, persisted })

      // Orders <= boundary are acked, the rest pending.
      for (const s of survived.steps) {
        expect(s.acked).toBe(s.order <= boundary)
      }
      // Resume: walking the survived plan finishes the rest and completes.
      const resumed = walkUntilCrash(survived, { persisted: [] })
      expect(planFullyAcked(resumed)).toBe(true)
    })
  }

  it('assoc (order 6) is LAST: a crash before it leaves assoc un-acked (construct fail-closed)', () => {
    const persisted: TeppMigrationPlan[] = []
    const survived = walkUntilCrash(buildMigrationPlan(makeFamily()), {
      crashAfterOrder: 5,
      persisted,
    })
    const assoc = survived.steps.find((s) => s.order === 6)!
    expect(assoc.acked).toBe(false)
    expect(planFullyAcked(survived)).toBe(false)
  })

  it('order-5 (state) is reached only after orders 1–4 acked', () => {
    const persisted: TeppMigrationPlan[] = []
    walkUntilCrash(buildMigrationPlan(makeFamily()), { crashAfterOrder: 5, persisted })
    // The persisted snapshots are written in ascending order; the snapshot at
    // which order 5 first flips acked has 1–4 already acked.
    const snapWith5 = persisted.find((p) => p.steps.find((s) => s.order === 5)!.acked)!
    for (const order of [1, 2, 3, 4]) {
      expect(snapWith5.steps.find((s) => s.order === order)!.acked).toBe(true)
    }
  })
})

describe('runMigration resume — assoc skip then retrigger', () => {
  it('deferring the assoc (kid not logged in) leaves it un-acked so a later run retries it', () => {
    const persisted: TeppMigrationPlan[] = []
    // First pass: kid not logged in → skip order 6.
    const afterPass1 = walkUntilCrash(buildMigrationPlan(makeFamily()), {
      skipOrder: (o) => o === 6,
      persisted,
    })
    expect(afterPass1.steps.find((s) => s.order === 6)!.acked).toBe(false)
    expect(planFullyAcked(afterPass1)).toBe(false)

    // Second pass: kid now logged in → assoc publishes and the plan completes.
    const afterPass2 = walkUntilCrash(afterPass1, { persisted: [] })
    expect(planFullyAcked(afterPass2)).toBe(true)
  })

  it('a publish FAILURE at order 2 halts the kid; orders 1 acked, 2–6 pending', () => {
    const survived = walkUntilCrash(buildMigrationPlan(makeFamily()), {
      failAtOrder: 2,
      persisted: [],
    })
    expect(survived.steps.find((s) => s.order === 1)!.acked).toBe(true)
    for (const order of [2, 3, 4, 5, 6]) {
      expect(survived.steps.find((s) => s.order === order)!.acked).toBe(false)
    }
  })
})

describe('runMigration resume — two-tab double-run convergence', () => {
  it('two runs over the SAME plan converge (markAcked is idempotent, no double-completion)', () => {
    const fresh = buildMigrationPlan(makeFamily())
    // Tab A runs to completion.
    const tabA = walkUntilCrash(fresh, { persisted: [] })
    expect(planFullyAcked(tabA)).toBe(true)
    // Tab B starts from tab A's already-complete plan: every step is acked, so
    // it publishes nothing and the plan stays complete (idempotent).
    const tabB = walkUntilCrash(tabA, { persisted: [] })
    expect(planFullyAcked(tabB)).toBe(true)
    expect(tabB.steps).toEqual(tabA.steps)
  })

  it('re-acking an already-acked step is a no-op (idempotent markAcked)', () => {
    const plan = buildMigrationPlan(makeFamily())
    const once = markAcked(plan, `${KID_A}:1`)
    const twice = markAcked(once, `${KID_A}:1`)
    expect(twice.steps.find((s) => s.id === `${KID_A}:1`)!.acked).toBe(true)
    expect(twice.steps.filter((s) => s.acked)).toHaveLength(1)
  })
})

describe('runMigration resume — multiple kids', () => {
  it('a crash mid-way through kid A leaves kid B entirely pending', () => {
    const family = makeFamily([
      { pubkey: KID_A, displayName: 'Kid A' },
      { pubkey: KID_B, displayName: 'Kid B' },
    ])
    const plan = buildMigrationPlan(family)
    expect(plan.steps).toHaveLength(12)
    // Ack only kid A's orders 1–3 (a crash mid-kid-A).
    let p = plan
    for (const order of [1, 2, 3]) p = markAcked(p, `${KID_A}:${order}`)
    // Kid B untouched.
    expect(p.steps.filter((s) => s.kidPubkey === KID_B).every((s) => !s.acked)).toBe(true)
    expect(planFullyAcked(p)).toBe(false)
  })
})
