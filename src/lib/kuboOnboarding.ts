import { NLogin, NUser } from '@nostrify/react/login';
import type { NPool, NostrEvent } from '@nostrify/nostrify';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';

import { saveNsec } from '@/lib/credentialManager';

/**
 * Generate a fresh Nostr identity (nsec + pubkey + npub).
 *
 * The nsec is NOT persisted here — callers should pass it to `saveNsec` and
 * `useLoginActions.nsec` to persist it and add it to Nostrify's login store.
 */
export function generateIdentity(): {
  nsec: `nsec1${string}`;
  pubkey: string;
  npub: `npub1${string}`;
} {
  const sk = generateSecretKey();
  const nsec = nip19.nsecEncode(sk);
  const pubkey = getPublicKey(sk);
  const npub = nip19.npubEncode(pubkey);
  return { nsec, pubkey, npub };
}

/**
 * Build the NIP-89 "client" tag (["client", <name>, <31990 addr?>, <relay?>]).
 *
 * Mirrors `buildClientTag` in `useNostrPublish` so kind 0 events we publish
 * during onboarding are tagged the same as events published via the hook.
 */
function buildClientTag(name: string, clientNaddr: string | undefined): string[] {
  if (!clientNaddr) return ['client', name];

  try {
    const decoded = nip19.decode(clientNaddr);
    if (decoded.type !== 'naddr') return ['client', name];
    const { kind, pubkey, identifier, relays } = decoded.data;
    const addr = `${kind}:${pubkey}:${identifier}`;
    const relayHint = relays?.[0];
    return relayHint ? ['client', name, addr, relayHint] : ['client', name, addr];
  } catch {
    return ['client', name];
  }
}

/**
 * Sign a kind 0 metadata event with the freshly generated nsec and publish it.
 *
 * This bypasses `useNostrPublish`/`useCurrentUser` because during onboarding we
 * may need to publish a kind 0 for an identity that is not yet the active
 * signer (e.g. publishing the parent's kind 0 immediately after generating it,
 * before React has re-rendered with the new `logins[0]`).
 */
export async function publishInitialProfile(params: {
  nostr: NPool;
  nsec: `nsec1${string}`;
  name: string;
  clientTagName: string;
  clientNaddr: string | undefined;
}): Promise<NostrEvent> {
  const { nostr, nsec, name, clientTagName, clientNaddr } = params;

  const login = NLogin.fromNsec(nsec);
  const user = NUser.fromNsecLogin(login);

  const created_at = Math.floor(Date.now() / 1000);
  const tags: string[][] = [buildClientTag(clientTagName, clientNaddr)];

  const event = await user.signer.signEvent({
    kind: 0,
    content: JSON.stringify({ name }),
    tags,
    created_at,
  });

  await nostr.event(event, { signal: AbortSignal.timeout(5000) });
  return event;
}

/**
 * Full onboarding step for a single identity:
 *   1. Generate a fresh nsec + pubkey.
 *   2. Save the nsec via the platform credential manager (Keychain / KeyStore /
 *      file download).
 *   3. Publish a kind 0 metadata event with the given display name.
 *
 * Does NOT add the login to Nostrify's store — callers do that via
 * `useLoginActions.nsec` after this resolves, since `addLogin` needs React
 * state setters from the hook.
 */
export async function onboardIdentity(params: {
  nostr: NPool;
  name: string;
  clientTagName: string;
  clientNaddr: string | undefined;
}): Promise<{ nsec: `nsec1${string}`; pubkey: string; npub: `npub1${string}` }> {
  const identity = generateIdentity();

  await saveNsec(identity.npub, identity.nsec);

  await publishInitialProfile({
    nostr: params.nostr,
    nsec: identity.nsec,
    name: params.name,
    clientTagName: params.clientTagName,
    clientNaddr: params.clientNaddr,
  });

  return identity;
}
