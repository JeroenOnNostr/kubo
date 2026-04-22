import { useFeedSettings } from '@/hooks/useFeedSettings';

/** Kubo-only hook: returns per-button visibility flags based on FeedSettings toggles. */
export function useActionVisibility() {
  const { feedSettings } = useFeedSettings();
  return {
    showReply: feedSettings.showReplyAction !== false,
    showRepost: feedSettings.showRepostAction !== false,
    showReaction: feedSettings.showReactionAction !== false,
    showZap: feedSettings.showZaps !== false,
    showShare: feedSettings.showShareAction !== false,
    showMore: feedSettings.showMoreAction !== false,
  };
}
