import { useCallback } from 'react';
import { NSecSigner, type NostrEvent } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { generateSecretKey } from 'nostr-tools/pure';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { isTeppEnforced } from '@/lib/tepp-adapters/useTeppEnforced';

import { useKuboFamily } from './useKuboFamily';

export interface TrustRequestsApi {
  hasPending: (targetPubkey: string) => boolean;
  request: (targetPubkey: string) => Promise<void>;
  cancel: (targetPubkey: string) => Promise<void>;
}

/**
 * Scoped read/write view of pending trust-upgrade requests for a single kid.
 * Mirrors `useTrustAssignments` — kid passes their own pubkey, parent passes
 * the selected kid. Writes are no-ops when `kidPubkey` is undefined.
 *
 * **Phase 5 (TEPP integration):** when `featureTepp` is on, `request()`
 * also publishes a NIP-59 gift wrap (kind 1059) carrying a structured
 * `kubo:request-to-interact` rumor to the parent. The relay only sees
 * "kid talks to parent." See [docs/tepp-integration.md](../../docs/tepp-integration.md#request-to-interact).
 *
 * The localStorage path stays active in BOTH flag states — that's the
 * source of truth for `hasPending()`, since the parent's view of pending
 * requests already reads it. The gift wrap is a parallel notification
 * channel for relays-side observation.
 */
export function useTrustRequests(kidPubkey: string | undefined): TrustRequestsApi {
  const { family, addTrustRequest, clearTrustRequest } = useKuboFamily();
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  // KUBO-200: gate the request gift-wrap publish on the authoritative
  // `family.teppEnforced` (via `isTeppEnforced`), not the clobberable
  // `feedSettings.featureTepp` mirror — so a freshly-added 2nd/3rd kid (whose
  // active-session mirror reads false) still publishes the request to the
  // parent. Local name kept as `featureTepp`.
  const featureTepp = isTeppEnforced(family, kidPubkey);

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

  const publishGiftWrap = useCallback(
    async (targetPubkey: string) => {
      if (!user || !family || !kidPubkey) return;
      // Sanity: only the kid themselves should publish their own request.
      if (user.pubkey !== kidPubkey) return;

      const rumor = {
        kind: 30382, // application-layer marker; only visible after unwrap.
        pubkey: user.pubkey,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['p', family.parentPubkey],
          ['target', targetPubkey],
          ['client', 'kubo'],
          ['request-type', 'interact-upgrade'],
        ],
        content: JSON.stringify({
          type: 'kubo:request-to-interact',
          target: targetPubkey,
          'requested-by': user.pubkey,
          'requested-at': Math.floor(Date.now() / 1000),
        }),
      };

      const nip44 = (user.signer as unknown as {
        nip44?: { encrypt: (pubkey: string, plaintext: string) => Promise<string> };
      }).nip44;
      if (!nip44) {
        // Without NIP-44, fall back silently to localStorage-only.
        return;
      }

      // Build a kind-13 seal addressed to the parent.
      const seal: Omit<NostrEvent, 'id' | 'sig'> = {
        kind: 13,
        pubkey: user.pubkey,
        created_at: rumor.created_at,
        tags: [],
        content: await nip44.encrypt(family.parentPubkey, JSON.stringify(rumor)),
      };
      // Seal is signed by the kid (real identity hidden inside the gift wrap).
      const sealedEvent = await user.signer.signEvent(seal);

      // Wrap with an ephemeral key so the relay can't tie the wrap to the kid.
      const ephemeral = new NSecSigner(generateSecretKey());
      const wrappedContent = await ephemeral.nip44!.encrypt(
        family.parentPubkey,
        JSON.stringify(sealedEvent),
      );
      // NIP-59 randomized timestamp (past, ±2 days).
      const twoDays = 2 * 24 * 60 * 60;
      const giftWrapTs =
        rumor.created_at - Math.floor(Math.random() * twoDays);
      const giftWrap = await ephemeral.signEvent({
        kind: 1059,
        created_at: giftWrapTs,
        tags: [['p', family.parentPubkey]],
        content: wrappedContent,
      });

      try {
        await nostr.event(giftWrap, { signal: AbortSignal.timeout(5000) });
      } catch {
        // Best-effort. localStorage already records the request, so the parent
        // sees it on their next visit even if the relay publish failed.
      }
    },
    [user, family, kidPubkey, nostr],
  );

  const request = useCallback(
    async (targetPubkey: string) => {
      if (!kidPubkey) return;
      await addTrustRequest(kidPubkey, targetPubkey);
      if (featureTepp) {
        // Fire-and-forget — UI-blocking the gift wrap publish would feel sluggish.
        publishGiftWrap(targetPubkey).catch(() => {});
      }
    },
    [kidPubkey, addTrustRequest, featureTepp, publishGiftWrap],
  );

  const cancel = useCallback(
    async (targetPubkey: string) => {
      if (!kidPubkey) return;
      await clearTrustRequest(kidPubkey, targetPubkey);
      // No NIP-09 deletion of the gift wrap envelope — the wrap is signed by
      // an ephemeral key, so we can't author a deletion for it. The parent's
      // localStorage view is the authoritative pending-requests state.
    },
    [kidPubkey, clearTrustRequest],
  );

  return { hasPending, request, cancel };
}
