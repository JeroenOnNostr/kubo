import { Capacitor } from '@capacitor/core';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useIsLargeViewport } from '@/hooks/useIsLargeViewport';
import { getKidSettings, useKuboFamily } from '@/hooks/useKuboFamily';

/**
 * Whether the ACTIVE kid's feed should use the tablet layout (a responsive grid,
 * browsable in any orientation, with button-only fullscreen). A per-kid setting
 * the parent controls in Kid settings (alongside View-only and Show Blobbi), so
 * it travels with the kid across the family's devices. Off (default) = the phone
 * mechanism (single portrait column + rotate-to-fullscreen).
 *
 * Read via `getKidSettings(activeUser.pubkey)`; we subscribe to the family store
 * (`useKuboFamily`) so a parent toggling it updates the kid's feed live. Outside
 * the kid app (no kid signer, or a parent browsing normally) this is false.
 *
 * On the WEB at tablet/desktop size we force it on regardless of the per-kid
 * setting: a desktop browser can't rotate, so the phone mechanism (single
 * portrait column + rotate-to-fullscreen) can't work there. Native never trips
 * this, so the native app's per-kid behavior is unchanged.
 */
export function useTabletMode(): boolean {
  const { user } = useCurrentUser();
  useKuboFamily(); // subscribe: re-render when the family record (kid settings) changes
  const isWebLarge = useIsLargeViewport() && !Capacitor.isNativePlatform();
  if (isWebLarge) return true;
  if (!user?.pubkey) return false;
  return getKidSettings(user.pubkey).tabletMode ?? false;
}
