import { useMutation } from '@tanstack/react-query';
import { NLogin, NUser, useNostrLogin } from '@nostrify/react/login';

import { useAppContext } from './useAppContext';
import { uploadFileWithSigner } from './useUploadFile';
import { getEffectiveBlossomServers } from '@/lib/appBlossom';

/**
 * Upload a file to Blossom using a kid's signer (the kid is NOT the active
 * login). Returns the uploaded URL.
 *
 * Accepts either `kidPubkey` (reads the nsec from the Nostrify login store) or
 * `nsec` directly — the explicit-nsec path is for the AddKidPage flow where
 * `login.nsec(...)` has just been called and the Nostrify `logins` state may
 * not have re-rendered yet in the same handler.
 */
type UploadKidAvatarArgs =
  | { file: File; nsec: `nsec1${string}` }
  | { file: File; kidPubkey: string };

export function useUploadKidAvatar() {
  const { logins } = useNostrLogin();
  const { config } = useAppContext();

  return useMutation({
    mutationFn: async (args: UploadKidAvatarArgs): Promise<string> => {
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

      const user = NUser.fromNsecLogin(NLogin.fromNsec(nsec));
      const servers = getEffectiveBlossomServers(
        config.blossomServerMetadata,
        config.useAppBlossomServers,
      );

      const tags = await uploadFileWithSigner(args.file, user.signer, servers);
      return tags[0][1];
    },
  });
}
