import { describe, expect, it } from 'vitest';

import { buildRelayUnionItems } from './useRelayTrustAssignments';
import type { KuboTrustLevel } from './useKuboFamily';

/**
 * KUBO-170 — the kind-8714 interaction-relay list is published under a single
 * shared d-tag (`<kid>:interact:relay`), so it must always carry the UNION of
 * the `interact` and `extend` tiers. Previously `setLevel('extend', …)`
 * published only the new URL (dropping every interact relay), the symmetric
 * interact path dropped extend relays, and `clear()` of an extend relay
 * returned early (the relay stayed admitted forever). The full set/clear flow
 * is hook-wrapped; per the repo pattern (see useTrustAssignments.test.ts) we
 * pin the pure list-building decision helper and drive it through the exact
 * round-trip from the task's "Done when".
 *
 * The mutators read a POST-WRITE snapshot of `relayTrustAssignments[kid]` and
 * feed it to `buildRelayUnionItems`; the helper's output IS what reaches the
 * `relayItems` of the published 8714/8715 event. So simulating the store map
 * after each set/clear and asserting the helper output exactly reproduces the
 * on-wire list.
 */

const A = 'wss://relay-a.example/';
const B = 'wss://relay-b.example/';
const C = 'wss://relay-c.example/';

type Assignments = Record<string, KuboTrustLevel>;

describe('buildRelayUnionItems (KUBO-170)', () => {
  it('puts interact and extend into the shared 8714 list, view into 8715', () => {
    const assignments: Assignments = {
      [A]: 'interact',
      [B]: 'extend',
      [C]: 'view',
    };
    const { view, interact } = buildRelayUnionItems(assignments);
    expect(interact.sort()).toEqual([A, B].sort());
    expect(view).toEqual([C]);
  });

  it('round-trip: set interact A, extend B → published 8714 list {A,B}', () => {
    // After `setLevel(A,'interact')` then `setLevel(B,'extend')` the store map
    // (post-write) is { A: interact, B: extend }. The 8714 publish reads this.
    const afterSets: Assignments = { [A]: 'interact', [B]: 'extend' };
    const { interact } = buildRelayUnionItems(afterSets);
    expect(interact.sort()).toEqual([A, B].sort());
  });

  it('round-trip: clear B (extend) → published 8714 list {A}, a real revocation', () => {
    // KUBO-170 bug: clear of an extend relay used to return early, leaving B in
    // the published 8714 forever. Now clear publishes the shrunken union.
    // Post-clear store map: { A: interact }.
    const afterClearB: Assignments = { [A]: 'interact' };
    const { interact } = buildRelayUnionItems(afterClearB);
    expect(interact).toEqual([A]);
    expect(interact).not.toContain(B);
  });

  it('round-trip: clear A (interact) with B still extend → published 8714 list {B}', () => {
    // Symmetric audit: clearing an interact relay must keep extend-tier relays
    // in the published union. Post-clear store map: { B: extend }.
    const afterClearA: Assignments = { [B]: 'extend' };
    const { interact } = buildRelayUnionItems(afterClearA);
    expect(interact).toEqual([B]);
    expect(interact).not.toContain(A);
  });

  it('clearing an interact relay keeps the extend relay (no cross-tier clobber)', () => {
    // Start { A: interact, B: extend }; clear A → { B: extend }.
    const before: Assignments = { [A]: 'interact', [B]: 'extend' };
    expect(buildRelayUnionItems(before).interact.sort()).toEqual([A, B].sort());
    const afterClearA: Assignments = { [B]: 'extend' };
    expect(buildRelayUnionItems(afterClearA).interact).toEqual([B]);
  });

  it('clearing the last interact-tier relay leaves an empty 8714 union', () => {
    // A genuine revocation of the whole list: publishing [] shrinks 8714 to
    // empty rather than leaving a stale admitted relay.
    const empty: Assignments = {};
    expect(buildRelayUnionItems(empty)).toEqual({ view: [], interact: [] });
  });

  it('view tier never leaks into the 8714 interact union', () => {
    const assignments: Assignments = { [A]: 'view', [B]: 'view' };
    const { view, interact } = buildRelayUnionItems(assignments);
    expect(interact).toEqual([]);
    expect(view.sort()).toEqual([A, B].sort());
  });
});
