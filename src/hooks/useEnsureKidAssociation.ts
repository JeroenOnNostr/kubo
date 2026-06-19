import { useEffect, useRef } from 'react';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';

import { useKuboFamily } from '@/hooks/useKuboFamily';
import { useParentSigner } from '@/hooks/useParentSigner';
import { useKidSigner } from '@/lib/tepp-adapters/useKidSigner';
import { isTeppEnforced } from '@/lib/tepp-adapters/useTeppEnforced';
import { useKuboTeppPublishAssociation } from '@/hooks/useKuboTeppPublish';
import { pickCurrentAssociation, parseAssociation } from '@/lib/tepp/parse';
import { KIND_ASSOCIATION } from '@/lib/tepp/kinds';
import { shouldRenewAssociation } from '@/lib/tepp-adapters/assocExpiry';

/**
 * Self-healing TEPP association (kind 17700) renewal guard (KUBO-149).
 *
 * The association is the root of a kid's construct: if it is missing or
 * expired, `useKuboTeppConstruct` returns `no-association` and ALL filtering
 * for that kid silently dies. The first-boot migration publishes it once with
 * a NIP-40 expiration, sets `family.teppMigratedAt`, and never runs again — so
 * before this hook existed, the association was a one-shot fuse with no
 * renewal: ~1y (previously 30d) after migration it expired and TEPP died
 * permanently with no recovery path.
 *
 * This hook closes that gap. On any session where the kid is the active /
 * logged-in signer and the parent is logged in, it (re)publishes the kid's
 * association when there is no current valid one (missing/expired) OR the
 * current one is within the renewal window of its expiry. It deliberately
 * does **NOT** gate on `teppMigratedAt`, which is what lets it recover an
 * already-"migrated"-but-now-dead install (the construct flips from
 * `no-association` back to `loaded` on next open).
 *
 * Reuses `useKuboTeppPublishAssociation` (the canonical "publish or rotate"
 * path: signs as the kid via `useKidSigner`, names the parent as guardian,
 * audits, and invalidates the construct query). The state event (34700) has
 * no expiration and survives, so republishing just the association is enough
 * to rebuild the construct.
 *
 * Mount once per active kid (see `KuboParentLayout` and the kid shell).
 */

/**
 * Per-kid, once-per-session guard. Module-level (not a ref) so it survives
 * re-renders/remounts within the session, mirroring `useEnsureParentTrust`.
 * A deferred attempt (kid/parent not yet logged in, query in flight) leaves
 * the guard unset so a later render retries.
 */
const reconciledKids = new Set<string>();

/** Test-only: reset the once-per-session renewal guard. */
export function __resetEnsureKidAssociationGuard(): void {
  reconciledKids.clear();
}

export function useEnsureKidAssociation(kidPubkey: string | undefined): void {
  const { nostr } = useNostr();
  const { family } = useKuboFamily();
  const { user: parentUser } = useParentSigner();
  const { user: kidUser } = useKidSigner(kidPubkey);
  const publishAssoc = useKuboTeppPublishAssociation(kidPubkey);

  // KUBO-200: gate the association publish on the authoritative
  // `family.teppEnforced` (via `isTeppEnforced`), not the clobberable
  // `feedSettings.featureTepp` mirror — otherwise a kid whose active-session
  // mirror reads false never publishes its kind-17700 association and its
  // construct can't assemble. Local name kept as `featureTepp`.
  const featureTepp = isTeppEnforced(family, kidPubkey);
  const isKid = !!kidPubkey && !!family?.kids.some((k) => k.pubkey === kidPubkey);

  // Keep the mutation in a ref so the effect doesn't list it as a dep (its
  // identity churns every render and would re-fire the effect).
  const publishRef = useRef(publishAssoc);
  publishRef.current = publishAssoc;

  useEffect(() => {
    if (!featureTepp || !isKid || !kidPubkey) return;
    // Both signers must be present: the kid signs the association, the parent
    // is named as guardian. If either is missing, defer (don't mark the guard)
    // so we retry once they rehydrate into the login store.
    if (!kidUser || !parentUser) return;
    if (reconciledKids.has(kidPubkey)) return;

    let cancelled = false;

    void (async () => {
      try {
        // Fetch the kid's current association(s) to read the live expiry.
        const events: NostrEvent[] = await nostr.query(
          [{ kinds: [KIND_ASSOCIATION], authors: [kidPubkey], limit: 10 }],
          { signal: AbortSignal.timeout(5000) },
        );
        if (cancelled) return;

        // `pickCurrentAssociation` returns the latest VALID (signed,
        // subject==pubkey, not-expired) one, or null. Null => renew.
        const current = pickCurrentAssociation(events);
        const currentExpiry = current
          ? current.expiration
          : // No valid current one. If an expired association exists, surface
            // its expiry so the predicate still reads "renew"; otherwise null.
            (events
              .map((e) => parseAssociation(e).expiration)
              .filter((n) => !Number.isNaN(n))
              .sort((a, b) => b - a)[0] ?? null);

        const now = Math.floor(Date.now() / 1000);
        if (!shouldRenewAssociation(currentExpiry, now)) {
          // Healthy and not near expiry — nothing to do this session.
          reconciledKids.add(kidPubkey);
          return;
        }

        // Mark the guard BEFORE publishing so a re-render mid-flight doesn't
        // double-publish; the mutation's onSuccess invalidates the construct.
        reconciledKids.add(kidPubkey);
        await publishRef.current.mutateAsync();
      } catch (err) {
        // Allow a retry on a later render (e.g. transient relay/query error).
        reconciledKids.delete(kidPubkey);
        console.warn('useEnsureKidAssociation: renewal failed', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [featureTepp, isKid, kidPubkey, kidUser, parentUser, nostr]);
}
