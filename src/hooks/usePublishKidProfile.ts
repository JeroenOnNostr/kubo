import { useMutation } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import { useNostrLogin } from '@nostrify/react/login';

import type { NostrMetadata } from '@nostrify/nostrify';

import { useAppContext } from './useAppContext';
import { publishKidProfileUpdate } from '@/lib/kidProfile';

/**
 * Publish a kind 0 metadata patch for a kid, signed by the kid.
 *
 * Accepts either `kidPubkey` (reads nsec from the Nostrify login store) or an
 * explicit `nsec` — the explicit-nsec form is for the AddKidPage flow where
 * `login.nsec(...)` was just called and `logins` may not have re-rendered
 * yet in the same handler (mirrors `publishInitialEncryptedSettings`).
 */
type PublishKidProfileArgs =
  | { patch: Partial<NostrMetadata>; nsec: `nsec1${string}` }
  | { patch: Partial<NostrMetadata>; kidPubkey: string };

export function usePublishKidProfile() {
  const { nostr } = useNostr();
  const { logins } = useNostrLogin();
  const { config } = useAppContext();

  return useMutation({
    mutationFn: async (args: PublishKidProfileArgs) => {
      let nsec: `nsec1${string}`;
      if ('nsec' in args) {
        nsec = args.nsec;
      } else {
        const login = logins.find(
          (l) => l.pubkey === args.kidPubkey && l.type === 'nsec',
        );
        if (!login || login.type !== 'nsec') {
          throw new Error("Kid's key isn't loaded on this device.");
        }
        nsec = login.data.nsec;
      }

      return publishKidProfileUpdate({
        nostr,
        nsec,
        patch: args.patch,
        clientTagName: config.clientName ?? config.appName,
        clientNaddr: config.client,
      });
    },
  });
}
