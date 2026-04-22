import { useNostrLogin } from '@nostrify/react/login';

import { type KuboKid, useKuboFamily } from './useKuboFamily';

/**
 * The "currently selected kid" on the parent side = whichever kid is the
 * active Nostr signer (logins[0]). Parents pick via the persistent
 * "Select kid" pill in the top-right of KuboParentLayout, which calls
 * setLogin() to swap signers.
 *
 * Returns null when logins[0] is the parent (or any non-kid account), or
 * when family state hasn't loaded yet. Every kid-scoped parent page derives
 * its kid context from this hook — no more URL :id params.
 */
export function useSelectedKid(): KuboKid | null {
  const { logins } = useNostrLogin();
  const { family } = useKuboFamily();

  const activePubkey = logins[0]?.pubkey;
  if (!activePubkey || !family) return null;

  return family.kids.find((k) => k.pubkey === activePubkey) ?? null;
}
