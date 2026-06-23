import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_KID_SETTINGS,
  getKidSettings,
  setFamily,
  clearFamily,
  type KuboFamily,
} from './useKuboFamily';

/**
 * KUBO-189 regression — a freshly-onboarded kid has NO `kidSettings` entry
 * (`addKid` seeds feedSources/trustAssignments only). `getKidSettings()` is the
 * single source of truth every consumer must read through, because it falls back
 * to `DEFAULT_KID_SETTINGS` for a kid that has no stored entry yet.
 *
 * The bug: `KidHomePage` read `family.kidSettings[pubkey]` RAW (`!!s?.nextPostButton`),
 * bypassing the default. For a fresh kid that yielded `false`, so the "Next post"
 * FAB never rendered and the feed ran uncapped (infinite scroll → all videos),
 * even though `nextPostButton` is default-ON. These tests pin the default so any
 * future consumer that diverges from `getKidSettings()` is caught at the source.
 *
 * Drives the in-memory family singleton via `setFamily` (writeAndNotify), since
 * `getKidSettings` reads that singleton, not localStorage directly.
 */

const PARENT = 'p'.repeat(64);
const KID = 'k'.repeat(64);

function freshFamily(overrides: Partial<KuboFamily> = {}): KuboFamily {
  return {
    parentPubkey: PARENT,
    parentDisplayName: 'Parent',
    kids: [{ pubkey: KID, displayName: 'Kid' }],
    ...overrides,
  };
}

beforeEach(async () => {
  localStorage.clear();
  await clearFamily();
});

afterEach(async () => {
  localStorage.clear();
  await clearFamily();
});

describe('getKidSettings default resolution (KUBO-189)', () => {
  it('returns the default-ON next-post button for a kid with no stored settings', async () => {
    // A freshly-onboarded kid: family exists, but no kidSettings entry for them.
    await setFamily(freshFamily());
    expect(DEFAULT_KID_SETTINGS.nextPostButton).toBe(true);
    expect(getKidSettings(KID).nextPostButton).toBe(true);
  });

  it('returns the default-ON Blobbi tab for a kid with no stored settings', async () => {
    await setFamily(freshFamily());
    expect(DEFAULT_KID_SETTINGS.showBlobbiTab).toBe(true);
    expect(getKidSettings(KID).showBlobbiTab).toBe(true);
  });

  it('returns the full default object when no family record exists at all', () => {
    // Cold start before bootstrap populates the singleton: must still be ON.
    expect(getKidSettings(KID).nextPostButton).toBe(true);
    expect(getKidSettings(KID)).toEqual(DEFAULT_KID_SETTINGS);
  });

  it('honors an explicit per-kid override once one is stored', async () => {
    await setFamily(
      freshFamily({
        kidSettings: {
          [KID]: { ...DEFAULT_KID_SETTINGS, nextPostButton: false },
        },
      }),
    );
    // A parent who deliberately turned it off must win over the default.
    expect(getKidSettings(KID).nextPostButton).toBe(false);
  });
});
