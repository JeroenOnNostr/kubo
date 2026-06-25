import { genUserName } from '@/lib/genUserName';
import type { NostrMetadata } from '@nostrify/nostrify';

/**
 * Get a display name for a user.
 * Uses metadata.name if available, otherwise generates a deterministic username.
 * Visual truncation is handled by CSS (`truncate` class) on the containing element
 * to avoid breaking NIP-30 custom emoji shortcodes.
 */
export function getDisplayName(
  metadata: NostrMetadata | undefined,
  pubkey: string,
): string {
  return metadata?.name || genUserName(pubkey);
}

/**
 * Render a name as a possessive for UI labels — `"Jason"` → `"Jason's"`,
 * so we say "Edit Jason's settings", "Jason's feed", "Jason's key", etc.
 *
 * Names already ending in "s" (or the Unicode-aware "S") get a bare apostrophe
 * ("Chris" → "Chris'") which is the common, less-fussy English convention and
 * reads cleanly in short UI strings. An empty/whitespace-only name is returned
 * unchanged so callers never render a stray apostrophe.
 */
export function possessive(name: string): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return name ?? '';
  return /s$/i.test(trimmed) ? `${trimmed}'` : `${trimmed}'s`;
}
