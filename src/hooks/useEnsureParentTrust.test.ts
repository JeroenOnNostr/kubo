import { describe, expect, it } from 'vitest';

import { decideRevocationAction } from './useEnsureParentTrust';
import {
  KIND_PERMISSION_INTERACTION_NPUB_A,
  KIND_PERMISSION_VIEW_NPUB_A,
} from '@/lib/tepp/kinds';
import type { Construct, ConstructEntry } from '@/lib/tepp/types';

/**
 * KUBO-169 — the reconcile phases live inside an effect (not unit-testable
 * without renderHook), so per repo idiom we pin the pure decisions they
 * delegate to: `computeMissingGrants` / `constructAdmitsAtTier` (in
 * useTrustAssignments.test.ts) and `decideRevocationAction` here.
 */

const KID = 'k'.repeat(64);
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

function npubEntry(kind: number, pubkeys: string[]): ConstructEntry {
  return {
    kind,
    sourceEventId: 'src',
    source: 'direct',
    items: pubkeys.map((pubkey) => ({ pubkey })),
    restrictions: [],
    monitorRelays: [],
  };
}

function makeConstruct(entries: ConstructEntry[]): Construct {
  return {
    subject: KID,
    guardians: [],
    entries,
    extensionTraces: [],
    inertAuditFindings: [],
  };
}

describe('decideRevocationAction (KUBO-169 failed-clear retries)', () => {
  it('RETRIES when the construct still admits the target (revocation never landed)', () => {
    const c = makeConstruct([npubEntry(KIND_PERMISSION_INTERACTION_NPUB_A, [A])]);
    expect(decideRevocationAction(c, A, 'interact')).toBe('retry');
  });

  it('CLEARS the marker when the construct no longer admits the target (wire already correct)', () => {
    const c = makeConstruct([npubEntry(KIND_PERMISSION_INTERACTION_NPUB_A, [B])]);
    // A is gone from the wire → nothing to publish, just drop the stale marker.
    expect(decideRevocationAction(c, A, 'interact')).toBe('clear-marker');
  });

  it('keys on the tier the target HELD when cleared (view list still admits → retry)', () => {
    const c = makeConstruct([npubEntry(KIND_PERMISSION_VIEW_NPUB_A, [A])]);
    expect(decideRevocationAction(c, A, 'view')).toBe('retry');
  });
});
