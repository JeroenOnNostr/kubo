import type { NostrEvent } from '@nostrify/nostrify';

import { useFeedSettings } from '@/hooks/useFeedSettings';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { getKidSettings, useKuboFamily } from '@/hooks/useKuboFamily';
import { useKuboTeppEvaluateEvent } from '@/hooks/useKuboTeppEvaluateEvent';

/**
 * Kubo-only hook: returns per-button visibility flags for the post action bar
 * and per-tile byline flags (NIP-05 identifier + relative timestamp).
 *
 * Resolution order per flag (three-layer AND):
 *   1. If `event` is provided AND the active signer is a Kubo kid AND
 *      featureTepp is on AND the kid's TEPP construct denies interaction
 *      with the event's author (or anything it references), the
 *      interaction-side flags become false. The TEPP gate never *enables*
 *      a button — it can only further restrict.
 *   2. If the active signer (logins[0]) is a Kubo kid AND that kid has an
 *      explicit override set in KidSettings, use the override.
 *   3. Otherwise, use the global FeedSettings toggle from /settings/hidden-features.
 *
 * The returned `teppVerdict` field surfaces the underlying verdict so
 * `PostActionBar` can render disabled-with-tooltip vs hidden, and dispatch
 * the request-to-interact flow when a TEPP-denied button is tapped.
 */
export function useActionVisibility(event?: NostrEvent) {
  const { feedSettings } = useFeedSettings();
  const { user } = useCurrentUser();
  const { family } = useKuboFamily();

  const activePubkey = user?.pubkey;
  const isKid = !!activePubkey && !!family?.kids.some((k) => k.pubkey === activePubkey);
  const kid = isKid ? getKidSettings(activePubkey) : null;

  // TEPP gate. Returns pass-through when flag is off / no construct loaded /
  // no event supplied — the existing layers (KidSettings, FeedSettings) win.
  const tepp = useKuboTeppEvaluateEvent(event, isKid ? activePubkey : undefined);
  const interactGate = !event ? true : tepp.canInteract;

  // pick(override, global) — undefined override inherits global; explicit false/true wins.
  const pick = (override: boolean | undefined, global: boolean) =>
    override !== undefined ? override : global !== false;

  return {
    showReply:         interactGate && pick(kid?.showReplyAction,    feedSettings.showReplyAction),
    showRepost:        interactGate && pick(kid?.showRepostAction,   feedSettings.showRepostAction),
    showReaction:      interactGate && pick(kid?.showReactionAction, feedSettings.showReactionAction),
    // Favorite (star) is kid-only and ALWAYS on. It's a private NIP-44
    // encrypted list (kind 30003, items in encrypted content), not a public
    // interaction, so it is exempt from the TEPP interact-gate and has no
    // parent toggle. Gate hard on isKid so it never shows for parent /
    // non-Kubo accounts.
    showFavorite:      isKid,
    showZap:           interactGate && pick(kid?.showZapAction,      feedSettings.showZaps),
    showShare:         interactGate && pick(kid?.showShareAction,    feedSettings.showShareAction),
    // TEPP-gated like the other interaction buttons: a kid should not see the
    // More menu (mute/report/copy/broadcast) on a view-only author's note —
    // the parent controls trust centrally in Trust → People (KUBO-147).
    showMore:          interactGate && pick(kid?.showMoreAction, feedSettings.showMoreAction),
    showNip05:         pick(kid?.showNip05,          feedSettings.showNip05),
    showPostTimestamp: pick(kid?.showPostTimestamp,  feedSettings.showPostTimestamp),
    showHashtags:      pick(kid?.showHashtags,       feedSettings.showHashtags),
    /** TEPP verdict for this event — undefined when no event was passed. */
    teppVerdict: event ? tepp : undefined,
  };
}
