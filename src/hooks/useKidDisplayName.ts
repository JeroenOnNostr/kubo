import { useAuthor } from './useAuthor';
import { useKuboFamily } from './useKuboFamily';
import { genUserName } from '@/lib/genUserName';

/**
 * Resolve a kid's display name for parent-side UI.
 *
 * Resolution order (parent's local label wins — they get the final say on
 * how their kid is labeled in their own UI):
 *   1. family.kids[].displayName (parent-chosen local name from onboarding)
 *   2. Nostr kind-0 metadata.name
 *   3. genUserName(pubkey) (deterministic fallback)
 */
export function useKidDisplayName(pubkey: string | undefined): string {
  const { data } = useAuthor(pubkey);
  const { family } = useKuboFamily();
  if (!pubkey) return '';
  const kid = family?.kids.find((k) => k.pubkey === pubkey);
  return kid?.displayName || data?.metadata?.name || genUserName(pubkey);
}
