import { NLogin, NUser } from '@nostrify/react/login';
import { nip19 } from 'nostr-tools';

import type { NPool, NostrEvent, NostrMetadata } from '@nostrify/nostrify';

// Mirrors `buildClientTag` in useNostrPublish.ts / kuboOnboarding.ts. Duplicated
// to avoid a cross-module refactor; lift to a shared module if a fourth call
// site appears.
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

export interface PublishKidProfileUpdateParams {
  nostr: NPool;
  nsec: `nsec1${string}`;
  patch: Partial<NostrMetadata>;
  clientTagName: string;
  clientNaddr: string | undefined;
}

/**
 * Read-modify-write a kid's kind 0 metadata event.
 *
 * Bypasses `useCurrentUser` entirely by signing with the kid's nsec via
 * `NLogin.fromNsec` + `NUser.fromNsecLogin`, so the parent can update a
 * kid's profile without ever making the kid the active signer (avoids the
 * KUBO-016 render-loop).
 *
 * Fetches the latest kind 0 from relays directly (ignoring TanStack / IndexedDB
 * caches) before merging so concurrent renames/shape edits aren't clobbered.
 * Preserves `published_at` per NIP-24, matching the behaviour of
 * `useNostrPublish` for replaceable events.
 */
export async function publishKidProfileUpdate(
  params: PublishKidProfileUpdateParams,
): Promise<NostrEvent> {
  const { nostr, nsec, patch, clientTagName, clientNaddr } = params;

  const login = NLogin.fromNsec(nsec);
  const user = NUser.fromNsecLogin(login);

  const [prev] = await nostr.query(
    [{ kinds: [0], authors: [user.pubkey], limit: 1 }],
    { signal: AbortSignal.timeout(5000) },
  );

  let prevMetadata: NostrMetadata = {};
  if (prev) {
    try {
      prevMetadata = JSON.parse(prev.content) as NostrMetadata;
    } catch {
      // Parse-fail → start from empty; worst case kid ends up with `{ ...patch }`,
      // same as a fresh onboarding publish.
    }
  }

  const content = JSON.stringify({ ...prevMetadata, ...patch });
  const created_at = Math.floor(Date.now() / 1000);

  const tags: string[][] = [buildClientTag(clientTagName, clientNaddr)];

  const prevPublishedAt = prev?.tags.find(([n]) => n === 'published_at')?.[1];
  tags.push(['published_at', prevPublishedAt ?? String(created_at)]);

  const event = await user.signer.signEvent({
    kind: 0,
    content,
    tags,
    created_at,
  });

  await nostr.event(event, { signal: AbortSignal.timeout(5000) });
  return event;
}
