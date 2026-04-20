import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Plus, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CategoryChips, type Category } from '@/components/feed/CategoryChips';
import {
  VideoFeedCard,
  type FeedVideo,
} from '@/components/feed/VideoFeedCard';

/**
 * /parent/home — home feed.
 *
 * Visual only. Placeholder video list; chip filter is local state and
 * filters the list client-side by `category`. A later data-layer PR
 * replaces the static array with a query over NIP-71 video events
 * filtered by the kid's trust-people graph.
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
  const [category, setCategory] = useState<Category>('all');

  const filtered = category === 'all' ? VIDEOS : VIDEOS.filter((v) => v.category === category);

  return (
    <div className="flex flex-col gap-4 pt-2 pb-6">
      {/* Header: wordmark + bell */}
      <div className="flex items-center justify-between px-4">
        <img src="/wordmark.svg" alt="Kubo" className="h-6" />
        <Button
          variant="ghost"
          size="icon"
          className="size-10 rounded-full"
          onClick={() => nav('/parent/alerts')}
          aria-label="Alerts"
        >
          <Bell className="size-5" />
        </Button>
      </div>

      {/* Search pill */}
      <div className="mx-4 flex items-center gap-2 h-11 px-4 rounded-full bg-card">
        <Search className="size-4 text-muted-foreground" aria-hidden />
        <span className="text-[13px] text-muted-foreground">
          Search videos, creators…
        </span>
      </div>

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
