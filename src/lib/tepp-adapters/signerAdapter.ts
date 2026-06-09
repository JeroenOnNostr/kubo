import type { NUser } from '@nostrify/react/login';
import * as nip19 from 'nostr-tools/nip19';
import type { EventTemplate, VerifiedEvent } from 'nostr-tools/pure';

import type { Signer, SignerKind } from './signerTypes';

/**
 * Translate a Kubo `NUser` into the TEPP `Signer` shape. The TEPP reference
 * code declares flat methods (`nip44Encrypt(plaintext, recipient)`) on the
 * signer; Kubo's `NUser` exposes a nested object (`signer.nip44.encrypt(
 * recipient, plaintext)`) — the argument order is also swapped. This
 * adapter is the single seam where that translation lives.
 *
 * See [docs/tepp-integration.md](../../../docs/tepp-integration.md#the-signer-adapter-arg-order-gotcha).
 */
export function teppSignerFromNUser(user: NUser, kind: SignerKind): Signer {
  const nip44 = (user.signer as unknown as {
    nip44?: {
      encrypt: (pubkey: string, plaintext: string) => Promise<string>;
      decrypt: (pubkey: string, ciphertext: string) => Promise<string>;
    };
  }).nip44;

  return {
    kind,
    pubkey: user.pubkey,
    npub: nip19.npubEncode(user.pubkey),
    describe: () => `${kind}:${user.pubkey.slice(0, 8)}…`,
    sign: (template: EventTemplate) =>
      user.signer.signEvent(template) as Promise<VerifiedEvent>,
    nip44Encrypt: nip44
      ? (plaintext, recipient) => nip44.encrypt(recipient, plaintext)
      : undefined,
    nip44Decrypt: nip44
      ? (ciphertext, sender) => nip44.decrypt(sender, ciphertext)
      : undefined,
  };
}
