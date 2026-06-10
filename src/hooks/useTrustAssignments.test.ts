import { describe, expect, it, vi } from 'vitest';

import {
  computeMissingGrants,
  constructAdmitsAtTier,
  runApprovalSequence,
  shouldUnfollowOnClear,
} from './useTrustAssignments';
import {
  KIND_PERMISSION_INTERACTION_NPUB_A,
  KIND_PERMISSION_VIEW_NPUB_A,
} from '@/lib/tepp/kinds';
import type { Construct, ConstructEntry } from '@/lib/tepp/types';

/**
 * KUBO-164 — clearing a person's trust must also drop them from the kid's
 * kind-3 follow list, so list and trust stay coherent. The unfollow is
 * published via `useFollowActions`, which signs with the ACTIVE login, so it
 * may only run when the kid being cleared IS the active login. The full clear
 * flow is hook-wrapped; per the repo pattern we pin the pure decision helper.
 */

const KID = 'k'.repeat(64);
const OTHER = 'o'.repeat(64);

describe('shouldUnfollowOnClear (KUBO-164)', () => {
  it('unfollows when the kid being cleared is the active login', () => {
    expect(shouldUnfollowOnClear(KID, KID)).toBe(true);
  });

  it('skips when the active login is a different user (would mis-sign the kind-3)', () => {
    // e.g. the parent is the active login → unfollowMany would edit the wrong
    // follow list. Skip and rely on the gate delta + later reconcile.
    expect(shouldUnfollowOnClear(OTHER, KID)).toBe(false);
  });

  it('skips when there is no active login', () => {
    expect(shouldUnfollowOnClear(undefined, KID)).toBe(false);
  });

  it('skips when no kid is selected', () => {
    expect(shouldUnfollowOnClear(KID, undefined)).toBe(false);
  });
});

// ─── KUBO-167: approval publishes TEPP, clears request only on success ────────

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

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

describe('runApprovalSequence (KUBO-167)', () => {
  it('publishes the grant then clears the request when enforced (in order)', async () => {
    const calls: string[] = [];
    const writeTrust = vi.fn(async () => { calls.push('write'); });
    const publishGrant = vi.fn(async () => { calls.push('publish'); });
    const clearRequest = vi.fn(async () => { calls.push('clear'); });

    await runApprovalSequence({ enforced: true, writeTrust, publishGrant, clearRequest });

    expect(calls).toEqual(['write', 'publish', 'clear']);
    expect(publishGrant).toHaveBeenCalledOnce();
    expect(clearRequest).toHaveBeenCalledOnce();
  });

  it('RETAINS the request (never clears) when the publish fails', async () => {
    const writeTrust = vi.fn(async () => {});
    const publishGrant = vi.fn(async () => { throw new Error('relay down'); });
    const clearRequest = vi.fn(async () => {});

    await expect(
      runApprovalSequence({ enforced: true, writeTrust, publishGrant, clearRequest }),
    ).rejects.toThrow('relay down');

    // The failure propagates BEFORE clearRequest — the request stays pending so
    // the parent can retry, and the kid is never "approved-but-denied".
    expect(clearRequest).not.toHaveBeenCalled();
  });

  it('skips the publish entirely when TEPP is off (localStorage-only)', async () => {
    const writeTrust = vi.fn(async () => {});
    const publishGrant = vi.fn(async () => {});
    const clearRequest = vi.fn(async () => {});

    await runApprovalSequence({ enforced: false, writeTrust, publishGrant, clearRequest });

    expect(publishGrant).not.toHaveBeenCalled();
    expect(writeTrust).toHaveBeenCalledOnce();
    expect(clearRequest).toHaveBeenCalledOnce();
  });
});

// ─── KUBO-169: construct-as-oracle diff helpers ──────────────────────────────

describe('constructAdmitsAtTier (KUBO-169)', () => {
  it('admits an interact-listed pubkey at interact', () => {
    const c = makeConstruct([npubEntry(KIND_PERMISSION_INTERACTION_NPUB_A, [A])]);
    expect(constructAdmitsAtTier(c, A, 'interact')).toBe(true);
    expect(constructAdmitsAtTier(c, B, 'interact')).toBe(false);
  });

  it('admits a view-listed pubkey at view', () => {
    const c = makeConstruct([npubEntry(KIND_PERMISSION_VIEW_NPUB_A, [A])]);
    expect(constructAdmitsAtTier(c, A, 'view')).toBe(true);
  });

  it('treats an interact entry as satisfying a view check (interact ⊇ view, no-downgrade)', () => {
    const c = makeConstruct([npubEntry(KIND_PERMISSION_INTERACTION_NPUB_A, [A])]);
    expect(constructAdmitsAtTier(c, A, 'view')).toBe(true);
  });

  it('does NOT treat a view entry as satisfying an interact check', () => {
    const c = makeConstruct([npubEntry(KIND_PERMISSION_VIEW_NPUB_A, [A])]);
    expect(constructAdmitsAtTier(c, A, 'interact')).toBe(false);
  });

  it('matches case-insensitively (construct items are lowercased)', () => {
    const c = makeConstruct([npubEntry(KIND_PERMISSION_VIEW_NPUB_A, [A])]);
    expect(constructAdmitsAtTier(c, A.toUpperCase(), 'view')).toBe(true);
  });
});

describe('computeMissingGrants (KUBO-169)', () => {
  it('returns localStorage-granted members the construct does not admit', () => {
    // A is on the wire, B and C are only in localStorage → missing.
    const c = makeConstruct([npubEntry(KIND_PERMISSION_VIEW_NPUB_A, [A])]);
    const assignments = { [A]: 'view', [B]: 'view', [C]: 'view' } as const;
    expect(new Set(computeMissingGrants(assignments, c, 'view'))).toEqual(
      new Set([B, C]),
    );
  });

  it('returns empty when the construct already matches (no churn)', () => {
    const c = makeConstruct([npubEntry(KIND_PERMISSION_INTERACTION_NPUB_A, [A, B])]);
    const assignments = { [A]: 'interact', [B]: 'interact' } as const;
    expect(computeMissingGrants(assignments, c, 'interact')).toEqual([]);
  });

  it('only considers members at the requested tier', () => {
    // B is recorded at interact; a view-tier diff must ignore it.
    const c = makeConstruct([]);
    const assignments = { [A]: 'view', [B]: 'interact' } as const;
    expect(computeMissingGrants(assignments, c, 'view')).toEqual([A]);
  });

  it('handles a missing assignments map', () => {
    const c = makeConstruct([]);
    expect(computeMissingGrants(undefined, c, 'view')).toEqual([]);
  });
});
