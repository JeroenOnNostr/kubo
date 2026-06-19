import { useState } from 'react';
import { IntroImage } from '@/components/IntroImage';
import {
  Palette, Trash2, Plus, UserX, Hash, MessageSquareOff, ExternalLink, ShieldAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { getAvatarShape } from '@/lib/avatarShape';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { useToast } from '@/hooks/useToast';
import { useFeedSettings } from '@/hooks/useFeedSettings';
import { useEncryptedSettings } from '@/hooks/useEncryptedSettings';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppContext } from '@/hooks/useAppContext';
import { useMuteList, type MuteListItem } from '@/hooks/useMuteList';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { EXTRA_KINDS, FEED_KINDS, SECTION_ORDER, SECTION_LABELS } from '@/lib/extraKinds';
import { CONTENT_KIND_ICONS } from '@/lib/sidebarItems';
import type { ContentWarningPolicy } from '@/contexts/AppContext';
import type { ExtraKindDef, SubKindDef } from '@/lib/extraKinds';

export function ContentSettings() {
  return (
    <div>
      {/* Intro */}
      <div className="px-3 pt-2 pb-4">
        <h2 className="text-sm font-semibold">What You See</h2>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          Customize your feed, choose what content appears, and control what you want to hide.
        </p>
      </div>

      {/* Notes Section */}
      <div>
        <div className="relative px-3 py-3.5">
          <h2 className="text-base font-semibold">Content Types</h2>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-primary rounded-full" />
        </div>
        <div className="pb-4">
          <div className="px-3 pt-3 pb-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Core content types that appear in your feed.
            </p>
          </div>

          {/* Column headers */}
          <div className="flex items-center justify-end gap-2 px-3 pb-2 border-b border-border">
            <span className="text-[11px] font-medium text-muted-foreground w-[52px] text-center">Feed</span>
          </div>

          <NotesFeedSettings />
        </div>
      </div>

      {/* Other Stuff Section */}
      <div>
        <div className="relative px-3 py-3.5">
          <h2 className="text-base font-semibold">More Content Types</h2>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-primary rounded-full" />
        </div>
        <div className="pb-4">
          {/* Intro section for Other Stuff */}
          <div className="flex items-center gap-4 px-3 pt-3 pb-4">
            <IntroImage src="/feed-intro.png" />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">Other Stuff</h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Nostr isn't just text posts — people publish all kinds of things. Pick what shows up in your sidebar and feed.
              </p>
            </div>
          </div>

          {/* Column headers */}
          <div className="flex items-center justify-end gap-2 px-3 pb-2 border-b border-border">
            <span className="text-[11px] font-medium text-muted-foreground w-[52px] text-center">Feed</span>
          </div>

          {/* Content type rows - reuse the internals from FeedSettingsForm */}
          <FeedSettingsFormInternals />
        </div>
      </div>

    </div>
  );
}



function KindBadge({ kind }: { kind: number }) {
  return (
    <span className="text-[10px] font-mono text-muted-foreground/60 shrink-0">
      [{kind}]
    </span>
  );
}

function SubKindRow({ sub }: { sub: SubKindDef }) {
  const { feedSettings, updateFeedSettings } = useFeedSettings();
  const { updateSettings } = useEncryptedSettings();
  const { user } = useCurrentUser();

  const handleToggle = async (key: string, value: boolean) => {
    updateFeedSettings({ [key]: value });
    if (user) {
      await updateSettings.mutateAsync({ feedSettings: { ...feedSettings, [key]: value } });
    }
  };

  return (
    <div className="flex items-center justify-between py-2.5 pl-12 pr-3 transition-colors">
      <div className="min-w-0">
        <span className="text-sm">{sub.label}</span>
        <p className="text-xs text-muted-foreground mt-0.5">
          <KindBadge kind={sub.kind} />{' '}{sub.description}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <div className="w-[52px] flex justify-center">
          <Switch
            checked={feedSettings[sub.feedKey]}
            onCheckedChange={(checked) => handleToggle(sub.feedKey, checked)}
            className="scale-90"
          />
        </div>
      </div>
    </div>
  );
}

function ContentTypeRow({ def }: { def: ExtraKindDef }) {
  const { feedSettings, updateFeedSettings } = useFeedSettings();
  const { updateSettings } = useEncryptedSettings();
  const { user } = useCurrentUser();
  const IconComponent = CONTENT_KIND_ICONS[def.id] ?? Palette;
  const icon = <IconComponent className="size-5" />;
  const hasSubKinds = !!def.subKinds;

  const handleToggle = async (key: string, value: boolean) => {
    updateFeedSettings({ [key]: value });
    if (user) {
      await updateSettings.mutateAsync({ feedSettings: { ...feedSettings, [key]: value } });
    }
  };

  return (
    <div className="border-b border-border last:border-b-0">
      <div className="flex items-center justify-between py-3.5 px-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-muted-foreground shrink-0">{icon}</span>
          <div className="min-w-0">
            <span className="text-sm font-medium">{def.label}</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              <KindBadge kind={def.kind} />{' '}{def.description}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-[52px] flex justify-center">
            {!hasSubKinds && def.feedKey ? (
              <Switch
                checked={feedSettings[def.feedKey]}
                onCheckedChange={(checked) => handleToggle(def.feedKey!, checked)}
              />
            ) : !hasSubKinds && def.feedOnly && def.showKey ? (
              <Switch
                checked={feedSettings[def.showKey] !== false}
                onCheckedChange={(checked) => handleToggle(def.showKey!, checked)}
              />
            ) : null}
          </div>
        </div>
      </div>

      {hasSubKinds && def.subKinds && def.subKinds.map((sub) => (
        <SubKindRow
          key={sub.feedKey}
          sub={sub}
        />
      ))}
    </div>
  );
}

function NotesFeedSettings() {
  return (
    <>
      {FEED_KINDS.map((def) => (
        <ContentTypeRow key={def.id} def={def} />
      ))}
    </>
  );
}

function FeedSettingsFormInternals() {
  return (
    <>
      {SECTION_ORDER.map((section) => {
        const sectionKinds = EXTRA_KINDS.filter((def) => def.section === section);
        if (sectionKinds.length === 0) return null;
        return (
          <div key={section}>
            <div className="px-3 pt-4 pb-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {SECTION_LABELS[section]}
              </span>
            </div>
            {sectionKinds.map((def) => (
              <ContentTypeRow key={def.id} def={def} />
            ))}
          </div>
        );
      })}
    </>
  );
}

const CW_POLICY_OPTIONS: { value: ContentWarningPolicy; label: string; description: string }[] = [
  {
    value: 'blur',
    label: 'Blur until revealed',
    description: 'Content is hidden behind a warning. Media is not loaded until you choose to view it.',
  },
  {
    value: 'hide',
    label: 'Hide completely',
    description: 'Posts with content warnings are removed from your feed entirely.',
  },
  {
    value: 'show',
    label: 'Always show',
    description: 'Ignore content warnings and display everything normally.',
  },
];

export function SensitiveContentSection() {
  const { config, updateConfig } = useAppContext();
  const { updateSettings } = useEncryptedSettings();
  const { user } = useCurrentUser();

  const handlePolicyChange = async (value: string) => {
    const policy = value as ContentWarningPolicy;
    updateConfig((current) => ({ ...current, contentWarningPolicy: policy }));
    if (user) {
      await updateSettings.mutateAsync({ contentWarningPolicy: policy });
    }
  };

  return (
    <div>
      {/* Intro */}
      <div className="flex items-center gap-4 px-3 pt-3 pb-4">
        <div className="w-40 shrink-0 flex items-center justify-center">
          <ShieldAlert className="size-16 text-muted-foreground/40" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Content Warnings</h3>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            Some posts are tagged with content warnings (NIP-36) by their authors. This can include NSFW material, spoilers, or other sensitive content.
          </p>
        </div>
      </div>

      {/* Policy options — consistent row style with other settings */}
      <RadioGroup
        value={config.contentWarningPolicy}
        onValueChange={handlePolicyChange}
        className="gap-0"
      >
        {CW_POLICY_OPTIONS.map((option) => (
          <label
            key={option.value}
            className="flex items-center justify-between py-3.5 px-3 border-b border-border last:border-b-0 cursor-pointer hover:bg-muted/20 transition-colors"
          >
            <div className="min-w-0">
              <span className="text-sm font-medium">{option.label}</span>
              <p className="text-xs text-muted-foreground mt-0.5">
                {option.description}
              </p>
            </div>
            <RadioGroupItem value={option.value} className="shrink-0" />
          </label>
        ))}
      </RadioGroup>
    </div>
  );
}

const MUTE_TYPE_CONFIG = {
  pubkey: {
    icon: <UserX className="size-5" />,
    label: 'Users',
    description: 'Hide posts from specific users',
    inputLabel: 'Public Key (hex or npub)',
    placeholder: 'npub1... or hex pubkey',
  },
  hashtag: {
    icon: <Hash className="size-5" />,
    label: 'Hashtags',
    description: 'Hide posts with specific hashtags',
    inputLabel: 'Hashtag (without #)',
    placeholder: 'bitcoin',
  },
  word: {
    icon: <MessageSquareOff className="size-5" />,
    label: 'Words',
    description: 'Hide posts containing specific words or phrases',
    inputLabel: 'Word or Phrase',
    placeholder: 'spam word',
  },
  thread: {
    icon: <MessageSquareOff className="size-5" />,
    label: 'Threads',
    description: 'Hide entire conversation threads',
    inputLabel: 'Event ID (hex or note)',
    placeholder: 'note1... or hex event ID',
  },
};

export function MuteSettingsInternals() {
  const { muteItems, isLoading, addMute, removeMute } = useMuteList();
  const { toast } = useToast();
  const [newMuteType, setNewMuteType] = useState<MuteListItem['type']>('pubkey');
  const [newMuteValue, setNewMuteValue] = useState('');

  const handleAddMute = async () => {
    if (!newMuteValue.trim()) {
      toast({ title: 'Error', description: 'Please enter a value', variant: 'destructive' });
      return;
    }

    try {
      await addMute.mutateAsync({
        type: newMuteType,
        value: newMuteValue.trim(),
      });

      toast({ title: 'Success', description: 'Mute added successfully' });
      setNewMuteValue('');
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to add mute',
        variant: 'destructive',
      });
    }
  };

  const handleRemoveMute = async (item: MuteListItem) => {
    try {
      await removeMute.mutateAsync(item);
      toast({ title: 'Success', description: 'Mute removed successfully' });
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to remove mute',
        variant: 'destructive',
      });
    }
  };

  const groupedMutes = {
    pubkey: muteItems.filter((item) => item.type === 'pubkey'),
    hashtag: muteItems.filter((item) => item.type === 'hashtag'),
    word: muteItems.filter((item) => item.type === 'word'),
    thread: muteItems.filter((item) => item.type === 'thread'),
  };

  return (
    <div>

      {/* Add mute section */}
      <div className="px-3 py-4 space-y-3 border-b border-border">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="mute-type" className="text-xs font-medium">Type</Label>
            <Select value={newMuteType} onValueChange={(value) => setNewMuteType(value as MuteListItem['type'])}>
              <SelectTrigger id="mute-type" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pubkey">
                  <div className="flex items-center gap-2">
                    <UserX className="h-4 w-4" />
                    User
                  </div>
                </SelectItem>
                <SelectItem value="hashtag">
                  <div className="flex items-center gap-2">
                    <Hash className="h-4 w-4" />
                    Hashtag
                  </div>
                </SelectItem>
                <SelectItem value="word">
                  <div className="flex items-center gap-2">
                    <MessageSquareOff className="h-4 w-4" />
                    Word/Phrase
                  </div>
                </SelectItem>
                <SelectItem value="thread">
                  <div className="flex items-center gap-2">
                    <MessageSquareOff className="h-4 w-4" />
                    Thread
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="mute-value" className="text-xs font-medium">
              {MUTE_TYPE_CONFIG[newMuteType].inputLabel}
            </Label>
            <Input
              id="mute-value"
              value={newMuteValue}
              onChange={(e) => setNewMuteValue(e.target.value)}
              placeholder={MUTE_TYPE_CONFIG[newMuteType].placeholder}
              className="h-9"
            />
          </div>
        </div>

        <Button 
          onClick={handleAddMute} 
          disabled={addMute.isPending} 
          size="sm"
          className="w-full sm:w-auto"
        >
          <Plus className="mr-2 h-4 w-4" />
          Add Mute
        </Button>
      </div>

      {/* Muted items list */}
      {isLoading ? (
        <div className="space-y-2 px-3 py-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : muteItems.length === 0 ? (
        <p className="text-muted-foreground text-center py-8 text-sm">
          No muted items yet
        </p>
      ) : (
        <>
          {Object.entries(groupedMutes).map(([type, items]) => {
            if (items.length === 0) return null;
            const config = MUTE_TYPE_CONFIG[type as MuteListItem['type']];
            
            return (
              <MuteTypeSection
                key={type}
                type={type as MuteListItem['type']}
                config={config}
                items={items}
                onRemove={handleRemoveMute}
                isPending={removeMute.isPending}
              />
            );
          })}
        </>
      )}
    </div>
  );
}

/** Renders a muted user's avatar and display name instead of a raw hex pubkey. */
function MutedUserProfile({ pubkey }: { pubkey: string }) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const avatarShape = getAvatarShape(metadata);
  const displayName = metadata?.name ?? genUserName(pubkey);

  if (author.isLoading) {
    return (
      <div className="flex items-center gap-2.5 min-w-0">
        <Skeleton className="size-7 rounded-full shrink-0" />
        <Skeleton className="h-3.5 w-24" />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <Avatar shape={avatarShape} className="size-7 shrink-0">
        <AvatarImage src={metadata?.picture} alt={displayName} />
        <AvatarFallback className="bg-primary/20 text-primary text-[10px]">
          {displayName[0]?.toUpperCase() ?? '?'}
        </AvatarFallback>
      </Avatar>
      <span className="text-sm truncate">{displayName}</span>
    </div>
  );
}

/** Renders a muted thread as a clickable link using the nevent identifier. */
function MutedThreadLink({ eventId }: { eventId: string }) {
  const nevent = nip19.neventEncode({ id: eventId });
  const shortId = eventId.slice(0, 8) + '…' + eventId.slice(-8);

  return (
    <Link
      to={`/${nevent}`}
      className="flex items-center gap-1.5 text-xs font-mono text-primary hover:underline truncate"
      onClick={(e) => e.stopPropagation()}
    >
      <ExternalLink className="size-3 shrink-0" />
      <span className="truncate">{shortId}</span>
    </Link>
  );
}

function MuteTypeSection({
  type: _type,
  config,
  items,
  onRemove,
  isPending,
}: {
  type: MuteListItem['type'];
  config: typeof MUTE_TYPE_CONFIG[keyof typeof MUTE_TYPE_CONFIG];
  items: MuteListItem[];
  onRemove: (item: MuteListItem) => void;
  isPending: boolean;
}) {
  return (
    <div className="border-b border-border last:border-b-0">
      <div className="flex items-center gap-3 px-3 py-3.5">
        <span className="text-muted-foreground shrink-0">{config.icon}</span>
        <div className="min-w-0">
          <span className="text-sm font-medium">{config.label}</span>
          <p className="text-xs text-muted-foreground mt-0.5">
            {items.length} {items.length === 1 ? 'item' : 'items'} • {config.description}
          </p>
        </div>
      </div>
      
      <div className="divide-y divide-border">
        {items.map((item, index) => (
          <div
            key={`${item.type}-${item.value}-${index}`}
            className="flex items-center justify-between py-2.5 px-3 pl-12 hover:bg-muted/20 transition-colors"
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {item.type === 'pubkey' ? (
                <MutedUserProfile pubkey={item.value} />
              ) : item.type === 'thread' ? (
                <MutedThreadLink eventId={item.value} />
              ) : (
                <code className="text-xs truncate font-mono bg-muted px-2 py-1 rounded">
                  {item.value}
                </code>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onRemove(item)}
              disabled={isPending}
              className="shrink-0 h-8 w-8 p-0"
            >
              <Trash2 className="h-4 w-4 text-destructive" />
             </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ThemePreferencesSection() {
  const { feedSettings, updateFeedSettings } = useFeedSettings();
  const { updateSettings } = useEncryptedSettings();
  const { user } = useCurrentUser();

  const showOnProfiles = feedSettings.showCustomProfileThemes !== false;

  const handleProfileThemeToggle = async (value: boolean) => {
    updateFeedSettings({ showCustomProfileThemes: value });
    if (user) {
      const updatedFeedSettings = { ...feedSettings, showCustomProfileThemes: value };
      await updateSettings.mutateAsync({ feedSettings: updatedFeedSettings });
    }
  };

  return (
    <div className="flex items-center justify-between">
      <div className="space-y-0.5">
        <Label className="text-sm font-medium">Show custom profile themes</Label>
        <p className="text-xs text-muted-foreground">Display other users' custom themes when visiting their profiles</p>
      </div>
      <Switch
        checked={showOnProfiles}
        onCheckedChange={handleProfileThemeToggle}
      />
    </div>
  );
}
