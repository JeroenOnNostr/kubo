import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import {
  shouldMirrorTeppOn,
  useTeppDefaultOnMigration,
} from './useTeppDefaultOnMigration';
import { KUBO_151_RELEASE_EPOCH_SECONDS } from '@/lib/tepp-adapters/useTeppEnforced';

// ─── Mocks for the no-hot-loop renderHook test ───────────────────────────────
const mockUpdateFeedSettings = vi.fn();
const mutateAsync = vi.fn();

const appCtx = { config: { feedSettings: { featureTepp: false } } } as {
  config: { feedSettings: { featureTepp?: boolean } };
};
const currentUser = {
  user: {
    pubkey: 'p'.repeat(64),
    signer: { nip44: {} },
  } as { pubkey: string; signer: { nip44?: unknown } } | undefined,
};
const familyState = {
  family: { parentPubkey: 'p'.repeat(64) } as { parentPubkey: string } | undefined,
};
const settingsState = {
  updateSettings: { mutateAsync },
  settingsEventCreatedAt: undefined as number | undefined,
};

vi.mock('@/hooks/useAppContext', () => ({ useAppContext: () => appCtx }));
vi.mock('@/hooks/useCurrentUser', () => ({ useCurrentUser: () => currentUser }));
vi.mock('@/hooks/useKuboFamily', () => ({ useKuboFamily: () => familyState }));
vi.mock('@/hooks/useFeedSettings', () => ({
  useFeedSettings: () => ({
    feedSettings: appCtx.config.feedSettings,
    updateFeedSettings: mockUpdateFeedSettings,
  }),
}));
vi.mock('@/hooks/useEncryptedSettings', () => ({
  useEncryptedSettings: () => settingsState,
}));

/**
 * KUBO-168 — the migration no longer does the old per-account `featureTepp` flip
 * loop (root cause of the oscillation). Its only remaining job is to mirror
 * `featureTepp:true` into the PARENT's synced settings, once, when the resolved
 * default-ON decision applies. `shouldMirrorTeppOn` is the pure gate; the hook's
 * `ranRef` latch guarantees a single attempt per boot (no within-boot retry on
 * failure → no hot-loop).
 */

const PARENT = 'p'.repeat(64);
const KID = 'k'.repeat(64);
const EPOCH = KUBO_151_RELEASE_EPOCH_SECONDS;
const PRE_EPOCH = EPOCH - 86400;
const POST_EPOCH = EPOCH + 86400;

describe('shouldMirrorTeppOn (KUBO-168 parent-mirror gate)', () => {
  it('parent + mirror false + no synced event → write (default-ON)', () => {
    expect(
      shouldMirrorTeppOn({
        activePubkey: PARENT,
        parentPubkey: PARENT,
        mirrorFeatureTepp: false,
        settingsEventCreatedAt: undefined,
      }),
    ).toBe(true);
  });

  it('legacy parent: pre-epoch synced false → write (default-ON wins)', () => {
    expect(
      shouldMirrorTeppOn({
        activePubkey: PARENT,
        parentPubkey: PARENT,
        mirrorFeatureTepp: false,
        settingsEventCreatedAt: PRE_EPOCH,
      }),
    ).toBe(true);
  });

  it('deliberate post-epoch opt-out → do NOT write (respect parent choice)', () => {
    expect(
      shouldMirrorTeppOn({
        activePubkey: PARENT,
        parentPubkey: PARENT,
        mirrorFeatureTepp: false,
        settingsEventCreatedAt: POST_EPOCH,
      }),
    ).toBe(false);
  });

  it('mirror already true → no churn (idempotent)', () => {
    expect(
      shouldMirrorTeppOn({
        activePubkey: PARENT,
        parentPubkey: PARENT,
        mirrorFeatureTepp: true,
        settingsEventCreatedAt: undefined,
      }),
    ).toBe(false);
  });

  it('active account is a KID, not the parent → never mirror (KUBO-152/168)', () => {
    // This is the old oscillation root cause: a kid login would get flipped.
    expect(
      shouldMirrorTeppOn({
        activePubkey: KID,
        parentPubkey: PARENT,
        mirrorFeatureTepp: false,
        settingsEventCreatedAt: undefined,
      }),
    ).toBe(false);
  });

  it('no active pubkey or no family → no write', () => {
    expect(
      shouldMirrorTeppOn({
        activePubkey: undefined,
        parentPubkey: PARENT,
        mirrorFeatureTepp: false,
        settingsEventCreatedAt: undefined,
      }),
    ).toBe(false);
    expect(
      shouldMirrorTeppOn({
        activePubkey: PARENT,
        parentPubkey: undefined,
        mirrorFeatureTepp: false,
        settingsEventCreatedAt: undefined,
      }),
    ).toBe(false);
  });
});

describe('useTeppDefaultOnMigration — no within-boot retry hot-loop (KUBO-168)', () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    mockUpdateFeedSettings.mockReset();
    appCtx.config.feedSettings = { featureTepp: false };
    currentUser.user = { pubkey: PARENT, signer: { nip44: {} } };
    familyState.family = { parentPubkey: PARENT };
    settingsState.settingsEventCreatedAt = undefined;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('a failed synced write is attempted exactly once per boot, across re-renders', async () => {
    mutateAsync.mockRejectedValue(new Error('relay down'));

    const { rerender } = renderHook(() => useTeppDefaultOnMigration());
    // Force several extra renders — a hot-loop would fire mutateAsync each time.
    rerender();
    rerender();
    rerender();

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    // Give any spurious re-attempt a tick to (not) happen.
    await new Promise((r) => setTimeout(r, 20));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    // Local config flip still happens so the session reflects ON immediately.
    expect(mockUpdateFeedSettings).toHaveBeenCalledWith({ featureTepp: true });
  });

  it('a deliberate post-epoch opt-out is never written', async () => {
    settingsState.settingsEventCreatedAt = KUBO_151_RELEASE_EPOCH_SECONDS + 86400;
    mutateAsync.mockResolvedValue(undefined);

    renderHook(() => useTeppDefaultOnMigration());
    await new Promise((r) => setTimeout(r, 20));
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(mockUpdateFeedSettings).not.toHaveBeenCalled();
  });
});
