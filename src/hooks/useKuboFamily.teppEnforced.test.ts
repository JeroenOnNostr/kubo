import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { adoptTeppEnforcedFromMirror, readLatest, type KuboFamily } from './useKuboFamily';

/**
 * KUBO-168 — the family-flag initialization (`adoptTeppEnforcedFromMirror`) must
 * be a single, idempotent, write-once path: it persists the already-resolved
 * value, and it NEVER touches a flag that has already been defined (even `false`).
 *
 * These run against the jsdom localStorage (secureStorage falls back to it off
 * native), seeding the `kubo:family` record directly.
 */

const PARENT = 'p'.repeat(64);
const KID = 'k'.repeat(64);
const STORAGE_KEY = 'kubo:family';

function seedFamily(overrides: Partial<KuboFamily> = {}): void {
  const fam: KuboFamily = {
    parentPubkey: PARENT,
    parentDisplayName: 'Parent',
    kids: [{ pubkey: KID, displayName: 'Kid' }],
    ...overrides,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(fam));
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('adoptTeppEnforcedFromMirror', () => {
  it('initializes an unset (undefined) flag with the resolved value', async () => {
    seedFamily({ teppEnforced: undefined });
    const next = await adoptTeppEnforcedFromMirror(true);
    expect(next?.teppEnforced).toBe(true);
    expect((await readLatest())?.teppEnforced).toBe(true);
  });

  it('can initialize to OFF (a deliberate post-epoch resolved false)', async () => {
    seedFamily({ teppEnforced: undefined });
    const next = await adoptTeppEnforcedFromMirror(false);
    expect(next?.teppEnforced).toBe(false);
  });

  it('is idempotent: an already-defined true flag is untouched', async () => {
    seedFamily({ teppEnforced: true });
    // Even if the resolved value disagrees, a defined flag is never overwritten.
    const next = await adoptTeppEnforcedFromMirror(false);
    expect(next?.teppEnforced).toBe(true);
    expect((await readLatest())?.teppEnforced).toBe(true);
  });

  it('is idempotent: an already-defined false flag is untouched', async () => {
    seedFamily({ teppEnforced: false });
    const next = await adoptTeppEnforcedFromMirror(true);
    expect(next?.teppEnforced).toBe(false);
    expect((await readLatest())?.teppEnforced).toBe(false);
  });

  it('no family record → no-op (returns null)', async () => {
    const next = await adoptTeppEnforcedFromMirror(true);
    expect(next).toBeNull();
  });
});
