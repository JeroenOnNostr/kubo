import { useSeoMeta } from '@unhead/react';
import { PageHeader } from '@/components/PageHeader';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useAppContext } from '@/hooks/useAppContext';
import { useFeedSettings } from '@/hooks/useFeedSettings';
import { useEncryptedSettings } from '@/hooks/useEncryptedSettings';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import type { FeedSettings } from '@/contexts/AppContext';

interface FeatureToggle {
  /** The FeedSettings key to flip. */
  key: keyof FeedSettings;
  /** Display label. */
  label: string;
  /** One-line description shown under the label. */
  description: string;
}

interface ToggleCategory {
  title: string;
  description: string;
  toggles: FeatureToggle[];
}

const CATEGORIES: ToggleCategory[] = [
  {
    title: 'Content types',
    description: 'Show or hide entire content surfaces. Hidden surfaces are removed from the sidebar and "+ More" menu.',
    toggles: [
      { key: 'showArticles', label: 'Articles', description: 'Long-form posts (NIP-23)' },
      { key: 'showEvents', label: 'Calendar events', description: 'Events and RSVPs (NIP-52)' },
      { key: 'showPolls', label: 'Polls', description: 'Polls (NIP-108) and the Poll mode in the compose box' },
      { key: 'showMusic', label: 'Music', description: 'Tracks, playlists, and albums' },
      { key: 'showPodcasts', label: 'Podcasts', description: 'Podcast episodes and trailers' },
      { key: 'showColors', label: 'Color moments', description: 'Color palette posts' },
      { key: 'showDecks', label: 'Magic decks', description: 'Magic: The Gathering decks' },
      { key: 'showTreasures', label: 'Geocaching', description: 'Treasures and found logs' },
      { key: 'showBlobbi', label: 'Virtual pets (Blobbi)', description: 'Pet companion overlay and Blobbi page' },
      { key: 'showLetters', label: 'Personal letters', description: 'Encrypted personal letters' },
      { key: 'showWebxdc', label: 'Webxdc mini-apps', description: 'Sandboxed mini-apps' },
      { key: 'showPacks', label: 'Follow packs', description: 'Curated lists of users to follow' },
      { key: 'showBadges', label: 'Badges', description: 'NIP-58 badge definitions and awards' },
      { key: 'showBooks', label: 'Books', description: 'Bookstr integration' },
      { key: 'showArchive', label: 'Archive', description: 'Internet Archive content' },
      { key: 'showWikipedia', label: 'Wikipedia', description: 'Wikipedia integration' },
      { key: 'showWorld', label: 'World', description: 'Geographic / world feed' },
      { key: 'showAIChat', label: 'AI Chat', description: 'AI chat integration' },
      { key: 'showDevelopment', label: 'Development', description: 'Git repos, NIPs, app submissions (NIP-34)' },
      { key: 'showEmojiPacks', label: 'Emoji packs', description: 'Custom emoji collections' },
    ],
  },
  {
    title: 'Post Actions',
    description: 'Control which action buttons appear on posts.',
    toggles: [
      { key: 'showReplyAction', label: 'Reply', description: 'Reply / comment button' },
      { key: 'showRepostAction', label: 'Repost', description: 'Repost and quote button' },
      { key: 'showReactionAction', label: 'Reactions', description: 'Like and emoji reaction button' },
      { key: 'showZaps', label: 'Zaps', description: 'Lightning zap button' },
      { key: 'showShareAction', label: 'Share', description: 'Copy link / share button' },
      { key: 'showMoreAction', label: 'More', description: 'More menu (report, mute, pin)' },
    ],
  },
  {
    title: 'Note display',
    description: 'Control which metadata appears in the byline of each note tile.',
    toggles: [
      { key: 'showNip05', label: 'NIP-05 identifier', description: 'Verified handle like @name@domain on note tiles' },
      { key: 'showPostTimestamp', label: 'Post timestamp', description: 'Relative time (e.g. "2h") on note tiles' },
    ],
  },
  {
    title: 'Customization',
    description: 'Personalization features that change how the app looks or feels.',
    toggles: [
      { key: 'showProfileThemes', label: 'Themes', description: 'Theme browser, custom themes, and profile theme updates' },
    ],
  },
  {
    title: 'Bridges',
    description: 'Integrations with other social networks.',
    toggles: [
      { key: 'showBluesky', label: 'Bluesky', description: 'Bluesky bridge feed' },
    ],
  },
];

function ToggleRow({ toggle }: { toggle: FeatureToggle }) {
  const { feedSettings, updateFeedSettings } = useFeedSettings();
  const { updateSettings } = useEncryptedSettings();
  const { user } = useCurrentUser();

  const value = !!feedSettings[toggle.key];

  async function handleChange(next: boolean) {
    updateFeedSettings({ [toggle.key]: next });
    if (user) {
      await updateSettings.mutateAsync({
        feedSettings: { ...feedSettings, [toggle.key]: next },
      }).catch(() => {});
    }
  }

  const id = `hidden-feature-${toggle.key}`;
  return (
    <div className="flex items-start gap-4 rounded-xl px-3 py-2.5 transition-colors hover:bg-muted/40">
      <div className="flex-1 min-w-0">
        <Label htmlFor={id} className="text-sm font-medium cursor-pointer">
          {toggle.label}
        </Label>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
          {toggle.description}
        </p>
      </div>
      <Switch
        id={id}
        checked={value}
        onCheckedChange={handleChange}
        className="mt-0.5 shrink-0"
      />
    </div>
  );
}

export function HiddenFeaturesSettingsPage() {
  const { config } = useAppContext();

  useSeoMeta({
    title: `Hidden features | Settings | ${config.appName}`,
    description: 'Show or hide app features',
  });

  return (
    <main>
      <PageHeader
        backTo="/settings"
        alwaysShowBack
        titleContent={
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold">Hidden features</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Toggle features on or off. Off means hidden from the sidebar, action bars, and compose box.
            </p>
          </div>
        }
      />

      <div className="p-4 space-y-6">
        {CATEGORIES.map((category) => (
          <section key={category.title}>
            <div className="px-3 pb-2">
              <h2 className="text-base font-semibold">{category.title}</h2>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                {category.description}
              </p>
            </div>
            <div className="space-y-1">
              {category.toggles.map((toggle) => (
                <ToggleRow key={toggle.key} toggle={toggle} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
