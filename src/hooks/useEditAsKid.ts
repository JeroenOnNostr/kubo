import { useEffect, useRef, useState } from 'react';
import { useNostrLogin } from '@nostrify/react/login';

import { useCurrentUser } from '@/hooks/useCurrentUser';

export type UseEditAsKidResult =
  /** The kid's key isn't stored on this device (extension / bunker / not registered). */
  | { status: 'unavailable'; kidLoginExists: false; switched: false }
  /** Swap in progress — `user` is either the parent or undefined for a frame. */
  | { status: 'swapping'; kidLoginExists: true; switched: false }
  /** Active signer is the kid. Safe to render Ditto components that read per-user state. */
  | { status: 'ready'; kidLoginExists: true; switched: true };

/**
 * Temporarily swap the active Nostr login to a kid for the lifetime of the
 * calling component, so Ditto components that read per-user state (feed
 * settings, relay list, Blossom servers) operate on the kid's account.
 *
 * Restores the original (non-kid) login on unmount. Known best-effort limit:
 * browser back or tab close while the component is mounted leaves the kid as
 * the active signer. A visible "editing as {kid}" banner + hardened restore
 * is a planned follow-up (KUBO-013-adjacent).
 *
 * @param kidPubkey The kid's hex pubkey — matches the `:id` route param on
 *   `/parent/kid/:id/*` routes, which in turn matches the `nsec:<pubkey>`
 *   login id shape Ditto uses for nsec-based logins.
 */
export function useEditAsKid(kidPubkey: string): UseEditAsKidResult {
  const { logins, setLogin } = useNostrLogin();
  const { user } = useCurrentUser();

  const kidLoginId = `nsec:${kidPubkey}`;
  const kidLoginExists = logins.some((l) => l.id === kidLoginId);

  // Capture the non-kid login id once, on mount. After setLogin swaps the kid
  // to logins[0], logins[0].id would point at the kid — too late to remember
  // who to restore. If the parent is already logged in as the kid for some
  // reason, fall back to any other available login.
  const originalLoginId = useRef<string | null>(
    logins.find((l) => l.id !== kidLoginId)?.id ?? null,
  );

  const [switched, setSwitched] = useState(user?.pubkey === kidPubkey);

  useEffect(() => {
    if (!kidLoginExists) return;
    if (user?.pubkey === kidPubkey) {
      setSwitched(true);
      return;
    }
    setLogin(kidLoginId);
  }, [kidLoginExists, kidLoginId, kidPubkey, user?.pubkey, setLogin]);

  useEffect(() => {
    if (user?.pubkey === kidPubkey) setSwitched(true);
  }, [user?.pubkey, kidPubkey]);

  useEffect(() => {
    const parentId = originalLoginId.current;
    return () => {
      if (parentId && parentId !== kidLoginId) {
        setLogin(parentId);
      }
    };
  }, [kidLoginId, setLogin]);

  if (!kidLoginExists) {
    return { status: 'unavailable', kidLoginExists: false, switched: false };
  }
  if (!switched) {
    return { status: 'swapping', kidLoginExists: true, switched: false };
  }
  return { status: 'ready', kidLoginExists: true, switched: true };
}
