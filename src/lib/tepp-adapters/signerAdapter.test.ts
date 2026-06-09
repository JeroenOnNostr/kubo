import { describe, expect, it, vi } from 'vitest';
import type { NUser } from '@nostrify/react/login';

import { teppSignerFromNUser } from './signerAdapter';

function makeFakeNUser(opts: {
  pubkey?: string;
  withNip44?: boolean;
} = {}): NUser {
  const pubkey = opts.pubkey ?? 'a'.repeat(64);
  const nip44 = opts.withNip44
    ? {
      // Kubo's nested form: encrypt(pubkey, plaintext)
      encrypt: vi.fn(async (_pk: string, pt: string) => `enc:${pt}`),
      decrypt: vi.fn(async (_pk: string, ct: string) => ct.replace(/^enc:/, '')),
    }
    : undefined;
  return {
    pubkey,
    signer: {
      signEvent: vi.fn(async (t) => ({
        ...t,
        id: 'fake-id',
        pubkey,
        sig: 'fake-sig',
      })),
      ...(nip44 ? { nip44 } : {}),
    },
  } as unknown as NUser;
}

describe('teppSignerFromNUser', () => {
  it('preserves pubkey and exposes a sign() that delegates to NUser.signer.signEvent', async () => {
    const user = makeFakeNUser({ pubkey: 'b'.repeat(64) });
    const signer = teppSignerFromNUser(user, 'kubo-nuser');
    expect(signer.pubkey).toEqual('b'.repeat(64));
    expect(signer.kind).toEqual('kubo-nuser');

    const signed = await signer.sign({
      kind: 1,
      content: 'hi',
      tags: [],
      created_at: 0,
    });
    expect(user.signer.signEvent).toHaveBeenCalledOnce();
    expect(signed.id).toEqual('fake-id');
  });

  it('translates the NIP-44 arg-order swap (TEPP flat (plaintext, pubkey) → Kubo nested (pubkey, plaintext))', async () => {
    const user = makeFakeNUser({ withNip44: true });
    const signer = teppSignerFromNUser(user, 'kubo-nuser');
    expect(signer.nip44Encrypt).toBeDefined();

    const recipient = 'c'.repeat(64);
    const ciphertext = await signer.nip44Encrypt!('hello', recipient);
    // Kubo nested encrypt(recipient, plaintext) was called with the args swapped from TEPP's order.
    const userSigner = user.signer as unknown as {
      nip44: { encrypt: ReturnType<typeof vi.fn> };
    };
    expect(userSigner.nip44.encrypt).toHaveBeenCalledWith(recipient, 'hello');
    expect(ciphertext).toEqual('enc:hello');
  });

  it('returns undefined nip44 methods when NUser.signer.nip44 is missing', () => {
    const user = makeFakeNUser({ withNip44: false });
    const signer = teppSignerFromNUser(user, 'kubo-nuser');
    expect(signer.nip44Encrypt).toBeUndefined();
    expect(signer.nip44Decrypt).toBeUndefined();
  });

  it('round-trips a nip44 encrypt+decrypt under the TEPP flat shape', async () => {
    const user = makeFakeNUser({ withNip44: true });
    const signer = teppSignerFromNUser(user, 'kubo-nuser');
    const recipient = 'd'.repeat(64);
    const ct = await signer.nip44Encrypt!('roundtrip', recipient);
    const pt = await signer.nip44Decrypt!(ct, recipient);
    expect(pt).toEqual('roundtrip');
  });
});
