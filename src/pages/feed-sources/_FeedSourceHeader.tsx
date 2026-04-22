import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * Shared header for the four feed-source browse screens. Underscored
 * filename so it doesn't register as a route if we ever glob-import pages.
 */
export function FeedSourceHeader({ title }: { title: string }) {
  const nav = useNavigate();
  return (
    <div className="flex items-center gap-2 px-4 pt-2">
      <Button
        variant="ghost"
        size="icon"
        className="size-9 rounded-full"
        onClick={() => nav('/parent/feed')}
        aria-label="Back"
      >
        <ChevronLeft className="size-5" />
      </Button>
      <h1 className="text-base font-semibold flex-1 truncate">{title}</h1>
    </div>
  );
}
