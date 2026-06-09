import type { EventTemplate, VerifiedEvent } from 'nostr-tools/pure';

/**
 * Mirror of TEPP's upstream `Signer` interface (tepp-webapp/src/auth/signer.ts).
 * Re-declared locally because that file is NOT subtreed (it imports across
 * folders into TEPP's own pool — see `src/lib/tepp/SOURCE.md`). Adding it
 * here lets the Kubo-owned construct + signing path reference the type
 * without dragging upstream's NIP-46 / browser-extension implementations.
 */
export type SignerKind = 'nip07' | 'localkey' | 'nip46' | 'kubo-nuser';

export interface Signer {
  kind: SignerKind;
  /** hex (lowercase, 64 chars) */
  pubkey: string;
  npub: string;
  describe(): string;
  sign(template: EventTemplate): Promise<VerifiedEvent>;
  nip04Encrypt?: (plaintext: string, recipientPubkey: string) => Promise<string>;
  nip04Decrypt?: (ciphertext: string, senderPubkey: string) => Promise<string>;
  nip44Encrypt?: (plaintext: string, recipientPubkey: string) => Promise<string>;
  nip44Decrypt?: (ciphertext: string, senderPubkey: string) => Promise<string>;
}
