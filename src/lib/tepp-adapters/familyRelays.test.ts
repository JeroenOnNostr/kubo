import { describe, expect, it } from 'vitest';

import {
  routesForEvent,
  teppReadRelays,
  isTeppKind,
  TEPP_KINDS,
  type RoutingConfig,
} from './familyRelays';
import {
  KIND_ASSOCIATION,
  KIND_STATE,
  KIND_BLACKLIST,
  KIND_GLOBAL_RESTRICTION,
  KIND_PERMISSION_VIEW_NPUB_A,
  PERMISSION_KINDS,
} from '@/lib/tepp/kinds';

/**
 * KUBO-173 part (1) — pure routing decision. TEPP events (a minor's social
 * graph + daily schedule) must be confined to the private family relay set and
 * NEVER fan out to the public write relays.
 */

const PUBLIC = [
  'wss://relay.kubo.watch/',
  'wss://relay.damus.io/',
  'wss://nos.lol/',
];
const FAMILY = ['wss://family.example/'];

const baseConfig = (over: Partial<RoutingConfig> = {}): RoutingConfig => ({
  familyRelays: [],
  primaryRelay: PUBLIC[0],
  defaultRelays: PUBLIC,
  ...over,
});

describe('TEPP_KINDS / isTeppKind', () => {
  it('covers all protocol kinds: 17700, 34700, 8710–8717, 8720, 8721', () => {
    const expected = [
      KIND_ASSOCIATION,
      KIND_STATE,
      ...PERMISSION_KINDS,
      KIND_BLACKLIST,
      KIND_GLOBAL_RESTRICTION,
    ];
    for (const k of expected) {
      expect(TEPP_KINDS.has(k)).toBe(true);
      expect(isTeppKind(k)).toBe(true);
    }
    // sanity: the permission band is the contiguous 8710–8717.
    for (let k = 8710; k <= 8717; k++) expect(isTeppKind(k)).toBe(true);
  });

  it('does not match ordinary kinds (1, 3, 6, 7, 30078)', () => {
    for (const k of [1, 3, 6, 7, 30078]) expect(isTeppKind(k)).toBe(false);
  });
});

describe('routesForEvent (KUBO-173)', () => {
  it('TEPP kind + family relay set → ONLY the family relays, no warning', () => {
    const out = routesForEvent(
      { kind: KIND_PERMISSION_VIEW_NPUB_A },
      baseConfig({ familyRelays: FAMILY }),
    );
    expect(out.relays).toEqual(FAMILY);
    expect(out.privacyWarning).toBe(false);
    expect(out.isTepp).toBe(true);
    // The public write relays receive nothing.
    for (const r of PUBLIC) expect(out.relays).not.toContain(r);
  });

  it('routes EVERY TEPP kind to the family relays (8712 spot-checked above; assoc/state/blacklist/global here)', () => {
    for (const kind of [KIND_ASSOCIATION, KIND_STATE, KIND_BLACKLIST, KIND_GLOBAL_RESTRICTION]) {
      const out = routesForEvent({ kind }, baseConfig({ familyRelays: FAMILY }));
      expect(out.relays).toEqual(FAMILY);
      expect(out.privacyWarning).toBe(false);
    }
  });

  it('TEPP kind + NO family relay → falls back to the primary relay + warning flag', () => {
    const out = routesForEvent(
      { kind: KIND_STATE },
      baseConfig({ familyRelays: [], primaryRelay: PUBLIC[0] }),
    );
    expect(out.relays).toEqual([PUBLIC[0]]);
    expect(out.privacyWarning).toBe(true);
    expect(out.isTepp).toBe(true);
  });

  it('TEPP kind + no family relay + no primary → falls back to public defaults + warning', () => {
    const out = routesForEvent(
      { kind: KIND_BLACKLIST },
      baseConfig({ familyRelays: [], primaryRelay: undefined }),
    );
    expect(out.relays).toEqual(PUBLIC);
    expect(out.privacyWarning).toBe(true);
  });

  it('non-TEPP kind (kind 1) → unchanged default routing, never a warning, never the family relays', () => {
    const out = routesForEvent({ kind: 1 }, baseConfig({ familyRelays: FAMILY }));
    expect(out.relays).toBe(PUBLIC); // pass-through, same reference
    expect(out.privacyWarning).toBe(false);
    expect(out.isTepp).toBe(false);
    expect(out.relays).not.toContain(FAMILY[0]);
  });

  it('non-TEPP kind 3 / 6 / 30078 all pass through unchanged', () => {
    for (const kind of [3, 6, 30078]) {
      const out = routesForEvent({ kind }, baseConfig({ familyRelays: FAMILY }));
      expect(out.relays).toBe(PUBLIC);
      expect(out.isTepp).toBe(false);
    }
  });

  it('dedupes and drops empty entries in the family set', () => {
    const out = routesForEvent(
      { kind: KIND_STATE },
      baseConfig({
        familyRelays: ['wss://fam.example/', '', '  ', 'wss://fam.example'],
      }),
    );
    // The two are the same relay (trailing-slash normalize) — one route.
    expect(out.relays).toHaveLength(1);
    expect(out.privacyWarning).toBe(false);
  });
});

describe('teppReadRelays (KUBO-173 read side)', () => {
  const READ = ['wss://relay.kubo.watch/', 'wss://relay.damus.io/'];

  it('TEPP-only query + family relay set → family ∪ read relays (family first)', () => {
    const out = teppReadRelays(
      [{ kinds: [KIND_STATE] }, { kinds: PERMISSION_KINDS as unknown as number[] }],
      FAMILY,
      READ,
    );
    expect(out).not.toBeNull();
    expect(out).toContain(FAMILY[0]);
    for (const r of READ) expect(out).toContain(r);
    expect(out![0]).toBe(FAMILY[0]); // family set comes first
  });

  it('TEPP-only query but NO family relay → null (defer to default read fan-out)', () => {
    expect(teppReadRelays([{ kinds: [KIND_STATE] }], [], READ)).toBeNull();
  });

  it('mixed kinds (one non-TEPP filter) → null (not a TEPP-only query)', () => {
    expect(
      teppReadRelays([{ kinds: [KIND_STATE] }, { kinds: [1] }], FAMILY, READ),
    ).toBeNull();
  });

  it('by-id referenced-event fetch (no kinds) → null (stays on general path)', () => {
    expect(teppReadRelays([{}], FAMILY, READ)).toBeNull();
  });

  it('empty filter list → null', () => {
    expect(teppReadRelays([], FAMILY, READ)).toBeNull();
  });
});
