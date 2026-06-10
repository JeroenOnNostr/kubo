import { useNostr } from '@nostrify/react';
import { type NLoginType, NUser, useNostrLogin } from '@nostrify/react/login';
import { NRelay1 } from '@nostrify/nostrify';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { useAuthor } from './useAuthor.ts';
import { signerWithNudge } from '@/lib/signerWithNudge';
import { useKuboFamily } from './useKuboFamily';
import { isTeppEnforced } from '@/lib/tepp-adapters/useTeppEnforced';
import { wrapKidSigner } from '@/lib/tepp-adapters/gatedSigner';

export function useCurrentUser() {
  const { nostr } = useNostr();
  const { logins } = useNostrLogin();
  const { family } = useKuboFamily();
  const queryClient = useQueryClient();

  const loginToUser = useCallback((login: NLoginType): NUser  => {
    let user: NUser;
    let isBunkerConnected: (() => boolean) | undefined;

    switch (login.type) {
      case 'nsec': // Nostr login with secret key
        user = NUser.fromNsecLogin(login);
        break;
      case 'bunker': { // Nostr login with NIP-46 "bunker://" URI
        user = NUser.fromBunkerLogin(login, nostr);
        // Called at nudge time to check whether any of the bunker's relay
        // WebSockets are OPEN. Relay instances are shared with the main pool
        // so pool.relays will contain them once they have been opened.
        const bunkerRelays = (login as Extract<NLoginType, { type: 'bunker' }>).data.relays;
        isBunkerConnected = () => bunkerRelays.some((url) => {
          const relay = nostr.relay(url);
          return relay instanceof NRelay1 && relay.socket.readyState === WebSocket.OPEN;
        });
        break;
      }
      case 'extension': // Nostr login with NIP-07 browser extension
        user = NUser.fromExtensionLogin(login);
        break;
      // Other login types can be defined here
      default:
        throw new Error(`Unsupported login type: ${login.type}`);
    }
    return new NUser(user.method, user.pubkey, signerWithNudge(user.signer, isBunkerConnected));
  }, [nostr]);

  const baseUsers = useMemo(() => {
    const users: NUser[] = [];

    for (const login of logins) {
      try {
        const user = loginToUser(login);
        users.push(user);
      } catch (error) {
        console.warn("Skipped invalid login", login.id, error);
      }
    }

    return users;
  }, [logins, loginToUser]);

  // KUBO-160: TEPP enforcement at the SIGNER SEAM. Every login → user mapping
  // goes through here, so this is the one place that covers ALL direct-publish
  // paths (group chat, trust requests, request-to-vanish, kid profile admin,
  // …), not just the two that route through `useNostrPublish`/`useZaps`. We
  // wrap ONLY a KID user's signer (`isTeppEnforced(family, pubkey)`) in a proxy
  // whose `signEvent` runs the same outbound TEPP evaluation as the hook gate
  // before delegating, throwing `TeppDeniedError` on deny. Parent (and any
  // non-enforced) signers are returned untouched. The proxy preserves the full
  // signer surface (nip04/nip44/getPublicKey pass through).
  //
  // The construct is resolved OUTSIDE React via the shared TanStack cache under
  // the SAME query key the hook uses, so there is no second construct path and
  // a warm construct is a cache hit. The parent's NIP-44 decrypt (needed for
  // the construct's private section) is read from the parent login in `logins`.
  const users = useMemo(() => {
    if (!isTeppEnforced(family, undefined) && !family?.teppEnforced) {
      // Fast path: enforcement off entirely → no wrapping work, no per-user
      // checks. (`isTeppEnforced(family, undefined)` is always false; the
      // explicit `family.teppEnforced` check is what short-circuits.)
      return baseUsers;
    }
    const parentPubkey = family?.parentPubkey;
    if (!parentPubkey) return baseUsers;
    const parentUser = baseUsers.find((u) => u.pubkey === parentPubkey);
    const parentNip44 = (parentUser?.signer as unknown as {
      nip44?: { decrypt: (pubkey: string, ciphertext: string) => Promise<string> };
    } | undefined)?.nip44;

    return baseUsers.map((u) => {
      if (!isTeppEnforced(family, u.pubkey)) return u; // parent / non-kid untouched
      const gatedSigner = wrapKidSigner(u.signer, {
        kidPubkey: u.pubkey,
        parentPubkey,
        queryClient,
        query: (filters, opts) => nostr.query(filters, opts),
        nip44Decrypt: parentNip44 ? (pk, ct) => parentNip44.decrypt(pk, ct) : undefined,
      });
      return new NUser(u.method, u.pubkey, gatedSigner);
    });
  }, [baseUsers, family, queryClient, nostr]);

  const user = users[0] as NUser | undefined;

  // The current user's kind 0 profile is served from useAuthor, which
  // may resolve instantly if pre-cached by useFeed. Otherwise it fetches
  // from relays in the background.
  const author = useAuthor(user?.pubkey);

  return {
    user,
    users,
    ...author.data,
    isLoading: author.isLoading,
  };
}
