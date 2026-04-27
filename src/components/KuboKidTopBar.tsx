import { useState } from 'react';
import { Clock, Settings } from 'lucide-react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useScreenTime } from '@/hooks/useScreenTime';
import { useScrollDirection } from '@/hooks/useScrollDirection';
import { getDisplayName } from '@/lib/getDisplayName';
import { ParentGateDialog } from '@/components/kid/ParentGateDialog';

/**
 * Shared kid-app top bar — `Hi {name}!` + time pill + parent-gate gear.
 *
 * Mounted once by KuboKidLayout. Per-screen titles ("Favorites", "Blobbi")
 * are absent here because the bottom nav already communicates which tab
 * is active.
 *
 * Two flavors:
 *   - <KuboKidTopBar /> — pinned, always visible (default).
 *   - <KuboKidScrollAwareTopBar /> — slides off-screen on scroll-down,
 *     reappears on scroll-up. Only routes that scroll the window should
 *     opt into this via useKidLayoutOptions({ scrollAware: true }).
 *
 * They are split rather than gated by a prop so the unconditional scroll
 * listener in useScrollDirection only attaches on routes that need it,
 * and so neither variant has to call hooks it doesn't use.
 */

export function KuboKidTopBar() {
  return <TopBarShell hidden={false} />;
}

export function KuboKidScrollAwareTopBar() {
  const { hidden } = useScrollDirection();
  return <TopBarShell hidden={hidden} />;
}

function TopBarShell({ hidden }: { hidden: boolean }) {
  const { user, metadata } = useCurrentUser();
  const kidName = user ? getDisplayName(metadata, user.pubkey) : '';
  const { remainingMinutes } = useScreenTime();

  const [gateOpen, setGateOpen] = useState(false);

  return (
    <>
      <header
        className="sticky top-0 z-30 transition-transform duration-300 ease-in-out will-change-transform"
        style={{
          background: '#1E3A8A',
          height: 'var(--kubo-kid-top-bar-height)',
          // KuboKidLayout owns the safe-area-top padding; this bar sits
          // inside that padded region so a plain -100% clears it entirely.
          transform: hidden ? 'translateY(-100%)' : undefined,
        }}
      >
        <div className="flex items-center justify-between px-5 h-full">
          <h1 className="text-[24px] font-bold leading-none truncate">
            Hi {kidName}!
          </h1>
          <div className="flex items-center gap-2 shrink-0">
            <div
              className="h-9 px-3 rounded-full flex items-center gap-1.5 text-[13px] font-semibold"
              style={{ background: 'rgba(255,255,255,0.2)' }}
            >
              <Clock className="size-4" />
              {remainingMinutes}
            </div>
            <button
              type="button"
              onClick={() => setGateOpen(true)}
              aria-label="Parent access"
              className="size-9 rounded-full flex items-center justify-center active:scale-95 transition-transform"
              style={{ background: 'rgba(255,255,255,0.15)' }}
            >
              <Settings className="size-5" />
            </button>
          </div>
        </div>
      </header>

      <ParentGateDialog open={gateOpen} onOpenChange={setGateOpen} />
    </>
  );
}
