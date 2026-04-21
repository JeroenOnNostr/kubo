import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Bell } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * /parent/alerts — inbox for requests from the kid + safety notifications.
 *
 * Empty state only. The real data source (kid-scoped acknowledgement events,
 * safety signals from the kid client) lands with the data-layer PR.
 */
export function ParentAlertsPage() {
  const nav = useNavigate();

  return (
    <div className="flex flex-col gap-4 px-4 pt-2 pb-6">
      {/* Top bar */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="size-9 rounded-full"
          onClick={() => nav('/parent/home')}
          aria-label="Back to home"
        >
          <ChevronLeft className="size-5" />
        </Button>
        <h1 className="text-base font-semibold flex-1">Alerts</h1>
      </div>

      <p className="text-[12px] text-muted-foreground px-1 -mt-1">
        Requests from your kid and safety notifications.
      </p>

      <div className="flex flex-col items-center gap-2 py-12 text-center">
        <Bell className="size-8 text-muted-foreground/60" aria-hidden />
        <div className="text-sm font-semibold">No alerts</div>
        <p className="text-[12px] text-muted-foreground max-w-[240px]">
          Requests from your kid and safety notifications will show up here.
        </p>
      </div>
    </div>
  );
}
