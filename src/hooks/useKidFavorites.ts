import { useNostr } from '@nostrify/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { NostrSigner } from '@nostrify/nostrify';
import { useCurrentUser } from './useCurrentUser';
import { useNostrPublish } from './useNostrPublish';
import { fetchFreshEvent } from '@/lib/fetchFreshEvent';

/**
 * Kid-scoped favorites list.
 *
 * Storage: NIP-51 categorized bookmarks (kind 30003) addressed by `d:'favorites'`.
 * Items (`['e', <eventId>]` rows) live in the encrypted `content` field rather
 * than public tags, so a kid's favorited events aren't a public dataset bound
 * to their nsec. Encryption is NIP-44 to the kid's own pubkey, with a NIP-04
 * fallback on read for any legacy events written by other clients.
 *
 * Forward-compat: a future "watch later" / "saved stories" list slots in as
 * another `d`-tag under the same kind, no migration needed.
 */

const FAVORITES_DTAG = 'favorites';
const KIND_FAVORITES = 30003;

function isNip04Encrypted(content: string): boolean {
  return content.includes('?iv=');
}

async function decryptFavoritesContent(
  content: string,
  signer: NostrSigner,
  pubkey: string,
): Promise<string[][] | null> {
  if (!content) return null;
  try {
    let decrypted: string | null = null;
    if (isNip04Encrypted(content)) {
      if (!signer.nip04) return null;
      decrypted = await signer.nip04.decrypt(pubkey, content);
    } else {
      if (!signer.nip44) return null;
      decrypted = await signer.nip44.decrypt(pubkey, content);
    }
    if (!decrypted) return null;
    const tags = JSON.parse(decrypted) as string[][];
    return Array.isArray(tags) ? tags : null;
  } catch (error) {
    console.error('Failed to decrypt favorites content:', error);
    return null;
  }
}

async function encryptFavoritesContent(
  privateTags: string[][],
  signer: NostrSigner,
  pubkey: string,
): Promise<string> {
  if (privateTags.length === 0) return '';
  if (!signer.nip44) {
    throw new Error('Signer does not support NIP-44 — cannot encrypt favorites.');
  }
  return signer.nip44.encrypt(pubkey, JSON.stringify(privateTags));
}

/** Hook to manage the kid's NIP-51 categorized favorites list (kind 30003, d:'favorites'). */
export function useKidFavorites() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  const { mutateAsync: publishEvent } = useNostrPublish();

  // Query the kid's favorites list event (kind 30003 with d='favorites' — addressable).
  const favoritesListQuery = useQuery({
    queryKey: ['kid-favorites', user?.pubkey],
    queryFn: async () => {
      if (!user) return null;
      const events = await nostr.query([{
        kinds: [KIND_FAVORITES],
        authors: [user.pubkey],
        '#d': [FAVORITES_DTAG],
        limit: 1,
      }]);
      const event = events[0] ?? null;
      if (!event) return { event: null, ids: [] as string[] };

      // Items live encrypted in content. We also accept public e-tags (in case
      // a different client wrote a public version) as a graceful fallback.
      let privateTags: string[][] | null = null;
      if (event.content) {
        privateTags = await decryptFavoritesContent(event.content, user.signer, user.pubkey);
      }
      const decryptedIds = (privateTags ?? [])
        .filter(([n]) => n === 'e')
        .map(([, id]) => id)
        .filter(Boolean);
      const publicIds = event.tags
        .filter(([n]) => n === 'e')
        .map(([, id]) => id)
        .filter(Boolean);

      // Dedupe (decrypted first, public appended).
      const seen = new Set<string>();
      const ids: string[] = [];
      for (const id of [...decryptedIds, ...publicIds]) {
        if (seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
      }
      return { event, ids };
    },
    enabled: !!user,
  });

  const favoritedIds: string[] = favoritesListQuery.data?.ids ?? [];

  // Query the actual favorited events.
  const favoritedEventsQuery = useQuery({
    queryKey: ['kid-favorited-events', favoritedIds],
    queryFn: async () => {
      if (favoritedIds.length === 0) return [];
      const events = await nostr.query([{
        ids: favoritedIds,
        limit: favoritedIds.length,
      }]);
      // Most recently favorited first — the last `e` row is the freshest.
      const idOrder = [...favoritedIds].reverse();
      return events.sort((a, b) => idOrder.indexOf(a.id) - idOrder.indexOf(b.id));
    },
    enabled: favoritedIds.length > 0,
  });

  function isFavorited(eventId: string): boolean {
    return favoritedIds.includes(eventId);
  }

  const toggleFavorite = useMutation({
    mutationFn: async (eventId: string) => {
      if (!user) throw new Error('User is not logged in');

      // Fetch the freshest version from relays before mutating so concurrent
      // edits across devices don't trample each other.
      const prev = await fetchFreshEvent(nostr, {
        kinds: [KIND_FAVORITES],
        authors: [user.pubkey],
        '#d': [FAVORITES_DTAG],
      });

      // Decrypt existing private items (if any).
      let privateTags: string[][] = [];
      if (prev?.content) {
        privateTags = (await decryptFavoritesContent(prev.content, user.signer, user.pubkey)) ?? [];
      }

      const currentlyFavorited = privateTags.some(
        ([name, id]) => name === 'e' && id === eventId,
      );

      let newPrivateTags: string[][];
      if (currentlyFavorited) {
        newPrivateTags = privateTags.filter(
          ([name, id]) => !(name === 'e' && id === eventId),
        );
      } else {
        // Append to the end so most-recent-favorite ordering is preserved on read.
        newPrivateTags = [...privateTags, ['e', eventId]];
      }

      const content = await encryptFavoritesContent(newPrivateTags, user.signer, user.pubkey);

      // Public tags carry only the d-tag — items are private.
      const publicTags: string[][] = [['d', FAVORITES_DTAG]];

      await publishEvent({
        kind: KIND_FAVORITES,
        content,
        tags: publicTags,
        created_at: Math.floor(Date.now() / 1000),
        prev: prev ?? undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kid-favorites', user?.pubkey] });
      queryClient.invalidateQueries({ queryKey: ['kid-favorited-events'] });
    },
  });

  return {
    /** Array of favorited event IDs (decrypted). */
    favoritedIds,
    /** The actual favorited NostrEvents, ordered most-recently-favorited first. */
    events: favoritedEventsQuery.data ?? [],
    isLoading: favoritesListQuery.isLoading,
    isLoadingEvents: favoritedEventsQuery.isLoading,
    isFavorited,
    toggleFavorite,
  };
}
