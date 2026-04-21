import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, ChevronRight, Settings, UserRound } from 'lucide-react';
import { useNostrLogin } from '@nostrify/react/login';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { CategoryChips, type Category } from '@/components/feed/CategoryChips';
import {
  VideoFeedCard,
  type FeedVideo,
} from '@/components/feed/VideoFeedCard';
import { useKuboFamily } from '@/hooks/useKuboFamily';
import { toast } from '@/hooks/useToast';

/**
 * /parent/home — home feed.
 *
 * The gear-icon dropdown lists each kid twice (under "Switch to kid view" and
 * "Switch to parent view"); clicking any entry flips the active Nostr signer
 * to that kid's nsec and navigates to the chosen route. The parent view is
 * always scoped to whichever kid is `logins[0]`.
 *
 * The video list is still placeholder data — a later data-layer PR replaces
 * it with a query over NIP-71 video events filtered by the current kid's
 * trust-people graph.
 */
type FeedItem = FeedVideo & { category: Exclude<Category, 'all'> };

const VIDEOS: FeedItem[] = [
  {
    id: '1',
    title: 'How do octopuses change colour? An easy guide for kids',
    creator: 'MarineKids',
    duration: '4:12',
    trust: 'High',
    thumbGradient: 'linear-gradient(135deg, #334155, #1E293B)',
    avatarBg: '#6366F1',
    category: 'animals',
  },
  {
    id: '2',
    title: 'Baking bread with grandma',
    creator: 'CozyKitchen',
    duration: '6:48',
    trust: 'Mid',
    thumbGradient: 'linear-gradient(135deg, #475569, #1E293B)',
    avatarBg: '#F97316',
    category: 'craft',
  },
  {
    id: '3',
    title: 'Sing along — Five little ducks',
    creator: 'StoryTime',
    duration: '2:31',
    trust: 'High',
    thumbGradient: 'linear-gradient(135deg, #7C3AED, #4C1D95)',
    avatarBg: '#6366F1',
    category: 'music',
  },
  {
    id: '4',
    title: 'Paper plate lion — craft tutorial',
    creator: 'CraftyKids',
    duration: '5:04',
    trust: 'Mid',
    thumbGradient: 'linear-gradient(135deg, #0891B2, #164E63)',
    avatarBg: '#22C55E',
    category: 'craft',
  },
];

export function ParentHomePage() {
  const nav = useNavigate();
  const { family } = useKuboFamily();
  const { logins, setLogin } = useNostrLogin();
  const [category, setCategory] = useState<Category>('all');

  const kids = family?.kids ?? [];

  const pickKid = (kidPubkey: string, destination: '/kid' | '/parent/home') => {
    const loginId = logins.find((l) => l.pubkey === kidPubkey)?.id;
    if (!loginId) {
      toast({
        title: "That kid's key isn't loaded",
        description: "Re-add the kid from the parent dashboard.",
        variant: 'destructive',
      });
      return;
    }
    setLogin(loginId);
    nav(destination);
  };

  const filtered = category === 'all' ? VIDEOS : VIDEOS.filter((v) => v.category === category);

  return (
    <div className="flex flex-col gap-4 pt-2 pb-6">
      {/* Header: wordmark + gear menu */}
      <div className="flex items-center justify-between px-4">
        <img src="/wordmark.svg" alt="Kubo" className="h-6" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-10 rounded-full"
              aria-label="Switch view"
            >
              <Settings className="size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Switch to kid view</DropdownMenuLabel>
            {kids.map((k) => (
              <DropdownMenuItem
                key={`kid-${k.pubkey}`}
                onClick={() => pickKid(k.pubkey, '/kid')}
                className="gap-2.5"
              >
                <span
                  className="size-6 rounded-full flex items-center justify-center flex-shrink-0 bg-muted"
                  aria-hidden
                >
                  <UserRound className="size-3.5 text-white" />
                </span>
                <span className="flex-1">{k.displayName}</span>
              </DropdownMenuItem>
            ))}

            <DropdownMenuSeparator />
            <DropdownMenuLabel>Switch to parent view</DropdownMenuLabel>
            {kids.map((k) => (
              <DropdownMenuItem
                key={`parent-${k.pubkey}`}
                onClick={() => pickKid(k.pubkey, '/parent/home')}
                className="gap-2.5"
              >
                <span
                  className="size-6 rounded-full flex items-center justify-center flex-shrink-0 bg-muted"
                  aria-hidden
                >
                  <UserRound className="size-3.5 text-white" />
                </span>
                <span className="flex-1">{k.displayName}</span>
              </DropdownMenuItem>
            ))}

            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => nav('/onboard/add-kid')}>
              Add a kid…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Search pill */}
      <div className="mx-4 flex items-center gap-2 h-11 px-4 rounded-full bg-card">
        <Search className="size-4 text-muted-foreground" aria-hidden />
        <span className="text-[13px] text-muted-foreground">
          Search videos, creators…
        </span>
      </div>

      {/* Kids rail */}
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between px-4">
          <h2 className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">
            Your kids
          </h2>
        </div>
        <div className="flex gap-3 overflow-x-auto no-scrollbar px-4 pb-1">
          {kids.map((k) => (
            <button
              key={k.pubkey}
              type="button"
              onClick={() => nav(`/parent/kid/${k.pubkey}`)}
              className={cn(
                'flex items-center gap-2.5 p-2 pr-3 rounded-full bg-card flex-shrink-0',
                'hover:bg-card/80 transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              )}
            >
              <div
                className="size-9 rounded-full flex-shrink-0 bg-muted flex items-center justify-center"
                aria-hidden
              >
                <UserRound className="size-4 text-white" />
              </div>
              <div className="flex flex-col items-start leading-tight">
                <span className="text-[13px] font-semibold">{k.displayName}</span>
              </div>
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
            </button>
          ))}
        </div>
      </section>

      {/* Category chips */}
      <CategoryChips
        value={category}
        options={['all', 'animals', 'music', 'craft', 'stories']}
        onChange={setCategory}
        className="mt-1"
      />

      {/* Feed */}
      <div className="flex flex-col gap-3 px-4">
        {filtered.map((v) => (
          <VideoFeedCard
            key={v.id}
            video={v}
            onClick={() => nav(`/parent/video/${v.id}`)}
          />
        ))}
        {filtered.length === 0 && (
          <div className="rounded-2xl bg-card p-8 text-center text-sm text-muted-foreground">
            Nothing here yet in {category}.
          </div>
        )}
      </div>

      {/* FAB */}
      <button
        type="button"
        onClick={() => nav('/parent/upload')}
        aria-label="Upload a video"
        className={cn(
          'fixed right-5 bottom-[calc(env(safe-area-inset-bottom,0px)+80px)]',
          'size-14 rounded-full bg-primary text-primary-foreground shadow-lg',
          'flex items-center justify-center',
          'hover:bg-primary/90 active:scale-95 transition-transform',
        )}
      >
        <Plus className="size-6" />
      </button>
    </div>
  );
}
