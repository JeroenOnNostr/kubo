import { useFeedSettings } from '@/hooks/useFeedSettings';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { getKidSettings, useKuboFamily } from '@/hooks/useKuboFamily';

/**
 * Kubo-only hook: returns per-button visibility flags for the post action bar
 * and per-tile byline flags (NIP-05 identifier + relative timestamp).
 *
 * Resolution order per flag:
 *   1. If the active signer (logins[0]) is a Kubo kid AND that kid has an
 *      explicit override set in KidSettings, use the override.
 *   2. Otherwise, use the global FeedSettings toggle from /settings/hidden-features.
 *
 * This lets parents gate each action button per-kid from /parent/kid-settings
 * while preserving Ditto's global toggles for non-kid contexts.
 */
export function useActionVisibility() {
  const { feedSettings } = useFeedSettings();
  const { user } = useCurrentUser();
  const { family } = useKuboFamily();

  const activePubkey = user?.pubkey;
  const isKid = !!activePubkey && !!family?.kids.some((k) => k.pubkey === activePubkey);
  const kid = isKid ? getKidSettings(activePubkey) : null;

  // pick(override, global) — undefined override inherits global; explicit false/true wins.
  const pick = (override: boolean | undefined, global: boolean) =>
    override !== undefined ? override : global !== false;

  return {
    showReply:         pick(kid?.showReplyAction,    feedSettings.showReplyAction),
    showRepost:        pick(kid?.showRepostAction,   feedSettings.showRepostAction),
    showReaction:      pick(kid?.showReactionAction, feedSettings.showReactionAction),
    showZap:           pick(kid?.showZapAction,      feedSettings.showZaps),
    showShare:         pick(kid?.showShareAction,    feedSettings.showShareAction),
    showMore:          pick(kid?.showMoreAction,     feedSettings.showMoreAction),
    showNip05:         pick(kid?.showNip05,          feedSettings.showNip05),
    showPostTimestamp: pick(kid?.showPostTimestamp,  feedSettings.showPostTimestamp),
  };
}
