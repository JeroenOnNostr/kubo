import { describe, expect, it } from 'vitest';

import {
  buildMigrationPlan,
  computeKidTemplates,
  markAcked,
  planFullyAcked,
  summarizeMigrationPlan,
  type TeppMigrationPlan,
} from './teppMigration';
import type { KuboFamily } from '@/hooks/useKuboFamily';

const PARENT = 'p'.repeat(64);
const KID_A = 'a'.repeat(64);
const KID_B = 'b'.repeat(64);
const TARGET_1 = '1'.repeat(64);
const TARGET_2 = '2'.repeat(64);

function makeFamily(overrides: Partial<KuboFamily> = {}): KuboFamily {
  return {
    parentPubkey: PARENT,
    parentDisplayName: 'Parent',
    kids: [{ pubkey: KID_A, displayName: 'Kid A' }],
    ...overrides,
  };
}

describe('computeKidTemplates', () => {
  it('builds permission + state + association templates from local trust assignments', () => {
    const family = makeFamily({
      trustAssignments: {
        [KID_A]: { [TARGET_1]: 'view', [TARGET_2]: 'interact' },
      },
    });

    const templates = computeKidTemplates({
      family,
      kidPubkey: KID_A,
      parentPubkey: PARENT,
    });

    const orders = templates.map((t) => t.order).sort((a, b) => a - b);
    // 1 view-npub, 2 interact-npub, 5 state, 6 assoc — no relay templates here.
    expect(orders).toEqual([1, 2, 5, 6]);

    const viewTpl = templates.find((t) => t.order === 1)!;
    expect(viewTpl.kind).toBe(8712);
    expect(viewTpl.template.tags.find((tg) => tg[0] === 'p')?.[1]).toBe(TARGET_1);

    const interactTpl = templates.find((t) => t.order === 2)!;
    expect(interactTpl.kind).toBe(8710);
    expect(interactTpl.template.tags.find((tg) => tg[0] === 'p')?.[1]).toBe(TARGET_2);

    const assocTpl = templates.find((t) => t.order === 6)!;
    expect(assocTpl.kind).toBe(17700);
  });

  it('seeds kind-8710 from kind-3 follows when the kid has zero local assignments (Q5)', () => {
    const family = makeFamily(); // no trustAssignments
    const follows = [TARGET_1, TARGET_2];

    const templates = computeKidTemplates({
      family,
      kidPubkey: KID_A,
      parentPubkey: PARENT,
      kindThreeFollows: follows,
    });

    const interactTpl = templates.find((t) => t.order === 2);
    expect(interactTpl).toBeDefined();
    expect(interactTpl!.kind).toBe(8710);
    const ps = interactTpl!.template.tags
      .filter((tg) => tg[0] === 'p')
      .map((tg) => tg[1]);
    expect(ps).toEqual(follows);
    // Seeded list MUST NOT carry an extend pair (Q5 fail-open is constrained
    // to the kind-3 follows the kid already had — no propagation).
    expect(interactTpl!.template.tags.find((tg) => tg[0] === 'extend')).toBeUndefined();
  });

  it('starts empty (no permission templates) when a kid has no assignments AND no kind-3 follows', () => {
    const family = makeFamily();

    const templates = computeKidTemplates({
      family,
      kidPubkey: KID_A,
      parentPubkey: PARENT,
      kindThreeFollows: [],
    });

    // Only state (5) and association (6) — parent must onboard manually.
    expect(templates.map((t) => t.order).sort()).toEqual([5, 6]);
  });

  it("emits an extend pair on the interact template when the kid has 'extend'-tier assignments", () => {
    const family = makeFamily({
      trustAssignments: {
        [KID_A]: { [TARGET_1]: 'extend' },
      },
    });

    const templates = computeKidTemplates({
      family,
      kidPubkey: KID_A,
      parentPubkey: PARENT,
    });

    const interactTpl = templates.find((t) => t.order === 2)!;
    expect(interactTpl.kind).toBe(8710);
    const extendTag = interactTpl.template.tags.find((tg) => tg[0] === 'extend');
    expect(extendTag).toBeDefined();
    // First entry after the tag name encodes `<kind>:<mutation>` per the
    // builder. Mode-A only — 8710 → 8710 as-is.
    expect(extendTag![1]).toBe('8710:as-is');
  });
});

describe('buildMigrationPlan', () => {
  it('produces 6 ordered steps per kid, none acked', () => {
    const family = makeFamily({
      kids: [
        { pubkey: KID_A, displayName: 'A' },
        { pubkey: KID_B, displayName: 'B' },
      ],
    });
    const plan = buildMigrationPlan(family);

    expect(plan.steps).toHaveLength(12);
    expect(plan.steps.every((s) => !s.acked)).toBe(true);
    // Each kid has steps with order 1-6.
    for (const kid of [KID_A, KID_B]) {
      const orders = plan.steps
        .filter((s) => s.kidPubkey === kid)
        .map((s) => s.order)
        .sort((a, b) => a - b);
      expect(orders).toEqual([1, 2, 3, 4, 5, 6]);
    }
    // step ids are stable + unique
    const ids = new Set(plan.steps.map((s) => s.id));
    expect(ids.size).toBe(12);
  });
});

describe('markAcked + planFullyAcked', () => {
  it('markAcked is monotonic: marking a step idempotently flips its flag', () => {
    const family = makeFamily();
    let plan: TeppMigrationPlan = buildMigrationPlan(family);
    const id = plan.steps[0].id;

    plan = markAcked(plan, id);
    expect(plan.steps.find((s) => s.id === id)?.acked).toBe(true);

    // Re-acking is a no-op
    plan = markAcked(plan, id);
    expect(plan.steps.filter((s) => s.acked)).toHaveLength(1);
  });

  it('markAcked returns a new plan (immutable update)', () => {
    const family = makeFamily();
    const original = buildMigrationPlan(family);
    const next = markAcked(original, original.steps[0].id);

    expect(next).not.toBe(original);
    expect(next.steps).not.toBe(original.steps);
    expect(original.steps[0].acked).toBe(false); // original untouched
  });

  it('planFullyAcked is true only after every step (including assoc, order 6) is acked', () => {
    const family = makeFamily();
    let plan: TeppMigrationPlan = buildMigrationPlan(family);

    // Ack every step EXCEPT the assoc (order 6).
    for (const step of plan.steps) {
      if (step.order !== 6) {
        plan = markAcked(plan, step.id);
      }
    }
    expect(planFullyAcked(plan)).toBe(false); // assoc-last invariant

    // Ack the assoc — now fully acked.
    const assocStep = plan.steps.find((s) => s.order === 6)!;
    plan = markAcked(plan, assocStep.id);
    expect(planFullyAcked(plan)).toBe(true);
  });
});

describe('summarizeMigrationPlan', () => {
  it('reports done/total counts and a startedAt timestamp', () => {
    const family = makeFamily();
    let plan: TeppMigrationPlan = buildMigrationPlan(family);
    expect(summarizeMigrationPlan(plan)).toContain('0/6');

    plan = markAcked(plan, plan.steps[0].id);
    expect(summarizeMigrationPlan(plan)).toContain('1/6');
  });
});
