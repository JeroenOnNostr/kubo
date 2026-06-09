import { describe, expect, it } from 'vitest';
import type { Construct, ParsedBlacklist, ParsedGlobal } from '@/lib/tepp/types';

import { constructFingerprintSync } from './fingerprint';

function makeConstruct(overrides: Partial<Construct> = {}): Construct {
  return {
    subject: 'a'.repeat(64),
    guardians: ['b'.repeat(64)],
    entries: [],
    extensionTraces: [],
    inertAuditFindings: [],
    ...overrides,
  };
}

describe('constructFingerprintSync', () => {
  it('returns the same hash for the same inputs', () => {
    const c = makeConstruct();
    expect(constructFingerprintSync(c, 'assoc-1')).toEqual(constructFingerprintSync(c, 'assoc-1'));
  });

  it('changes when the assoc id rotates', () => {
    const c = makeConstruct();
    expect(constructFingerprintSync(c, 'assoc-1'))
      .not.toEqual(constructFingerprintSync(c, 'assoc-2'));
  });

  it('changes when an entry is added', () => {
    const a = makeConstruct();
    const b = makeConstruct({
      entries: [{
        kind: 8710,
        sourceEventId: 'perm-1',
        source: 'direct',
        items: [],
        restrictions: [],
        monitorRelays: [],
      }],
    });
    expect(constructFingerprintSync(a, 'assoc'))
      .not.toEqual(constructFingerprintSync(b, 'assoc'));
  });

  it('is order-independent over entry sourceEventIds', () => {
    const c1 = makeConstruct({
      entries: [
        { kind: 8710, sourceEventId: 'p-a', source: 'direct', items: [], restrictions: [], monitorRelays: [] },
        { kind: 8712, sourceEventId: 'p-b', source: 'direct', items: [], restrictions: [], monitorRelays: [] },
      ],
    });
    const c2 = makeConstruct({
      entries: [
        { kind: 8712, sourceEventId: 'p-b', source: 'direct', items: [], restrictions: [], monitorRelays: [] },
        { kind: 8710, sourceEventId: 'p-a', source: 'direct', items: [], restrictions: [], monitorRelays: [] },
      ],
    });
    expect(constructFingerprintSync(c1, 'assoc')).toEqual(constructFingerprintSync(c2, 'assoc'));
  });

  it('reflects blacklist and global event ids', () => {
    const a = makeConstruct();
    const b = makeConstruct({
      blacklist: { raw: { id: 'bl-1' } } as unknown as ParsedBlacklist,
    });
    const c = makeConstruct({
      global: { raw: { id: 'gl-1' } } as unknown as ParsedGlobal,
    });
    const fpA = constructFingerprintSync(a, 'assoc');
    const fpB = constructFingerprintSync(b, 'assoc');
    const fpC = constructFingerprintSync(c, 'assoc');
    expect(fpA).not.toEqual(fpB);
    expect(fpA).not.toEqual(fpC);
    expect(fpB).not.toEqual(fpC);
  });
});
