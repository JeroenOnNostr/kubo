import { useCallback } from 'react';

import { useKuboFamily } from './useKuboFamily';

export interface TrustRequestsApi {
  hasPending: (targetPubkey: string) => boolean;
  request: (targetPubkey: string) => Promise<void>;
  cancel: (targetPubkey: string) => Promise<void>;
}

/**
 * Scoped read/write view of pending trust-upgrade requests for a single kid.
 * Mirrors `useTrustAssignments` — kid passes their own pubkey, parent passes
 * the selected kid. Writes are no-ops when `kidPubkey` is undefined (just
 * returns idempotently rather than throwing, since the kid-side button is
 * tappable as soon as `useCurrentUser` resolves).
 */
export function useTrustRequests(kidPubkey: string | undefined): TrustRequestsApi {
  const { family, addTrustRequest, clearTrustRequest } = useKuboFamily();

  const kidRequests =
    kidPubkey && family?.trustRequests
      ? family.trustRequests[kidPubkey]
      : undefined;

  const hasPending = useCallback(
    (targetPubkey: string): boolean => {
      return !!kidRequests && targetPubkey in kidRequests;
    },
    [kidRequests],
  );

  const request = useCallback(
    async (targetPubkey: string) => {
      if (!kidPubkey) return;
      await addTrustRequest(kidPubkey, targetPubkey);
    },
    [kidPubkey, addTrustRequest],
  );

  const cancel = useCallback(
    async (targetPubkey: string) => {
      if (!kidPubkey) return;
      await clearTrustRequest(kidPubkey, targetPubkey);
    },
    [kidPubkey, clearTrustRequest],
  );

  return { hasPending, request, cancel };
}
