import {
  KIND_PERMISSION_INTERACTION_NPUB_A,
  KIND_PERMISSION_INTERACTION_NPUB_B,
  KIND_PERMISSION_VIEW_NPUB_A,
  KIND_PERMISSION_VIEW_NPUB_B,
} from '@/lib/tepp/kinds';
import type { Construct } from '@/lib/tepp/types';

const NPUB_PERMISSION_KINDS = new Set<number>([
  KIND_PERMISSION_VIEW_NPUB_A,
  KIND_PERMISSION_VIEW_NPUB_B,
  KIND_PERMISSION_INTERACTION_NPUB_A,
  KIND_PERMISSION_INTERACTION_NPUB_B,
]);

/**
 * The set of author pubkeys (lowercase hex) the kid is allowed to SEE under a
 * loaded TEPP construct: every pubkey listed in a view-only or interaction
 * npub-permission entry, plus the kid's own pubkey (subject) — the kid always
 * sees their own posts. Blacklisted pubkeys are removed.
 *
 * This is the query-time allowlist: the kid feed scopes its relay/follow legs
 * to these authors so disallowed content is never fetched (rather than fetched
 * and hidden client-side). It mirrors the *incoming* admission the evaluator
 * computes per-author — see `evaluatePubkeyReference` in `src/lib/tepp/evaluate.ts`,
 * where an unlisted pubkey hard-denies — but as a cheap up-front set so the
 * feed query can ask the relay for only these authors.
 *
 * Note: this is an author-level allowlist only. Event-list (8716/8717) and
 * relay-list (8714/8715) permissions are not author-scoped and are intentionally
 * not expanded here; they remain enforced by the per-event evaluator on the
 * write/interaction path.
 */
export function getTeppAllowedAuthors(construct: Construct): string[] {
  const out = new Set<string>();
  out.add(construct.subject.toLowerCase());
  for (const entry of construct.entries) {
    if (!NPUB_PERMISSION_KINDS.has(entry.kind)) continue;
    for (const item of entry.items as Array<{ pubkey: string }>) {
      if (item?.pubkey) out.add(item.pubkey.toLowerCase());
    }
  }
  const blocked = construct.blacklist?.blockedPubkeys;
  if (blocked?.length) {
    for (const pk of blocked) out.delete(pk.toLowerCase());
  }
  return [...out];
}
