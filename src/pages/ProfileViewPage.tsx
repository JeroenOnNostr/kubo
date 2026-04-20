import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * /parent/profile/:npub — creator profile.
 *
 * Visual only. `Follow` and `Assign trust` buttons are local-state only;
 * Videos/About tabs show placeholder content. A later PR wires:
 *   - kind 0 metadata via useAuthor
 *   - follow mutation
 *   - AssignTrustLevelButton that opens a Sheet and updates the
 *     kid's trust-people list
 */
export function ProfileViewPage() {
  const nav = useNavigate();
  useParams(); // :npub — reserved for the data-layer PR

  const [tab, setTab] = useState<'videos' | 'about'>('videos');
  const [following, setFollowing] = useState(false);

  return (
    <div className="flex flex-col gap-3 pt-0 pb-6">
      {/* Banner */}
      <div
        className="relative h-32 mx-4 rounded-2xl mt-2"
        style={{ background: 'linear-gradient(135deg, #F97316, #EA580C)' }}
      >
        <Button
          variant="ghost"
          size="icon"
          className="absolute left-2 top-2 size-9 rounded-full bg-black/30 hover:bg-black/40 text-white"
          onClick={() => nav(-1)}
          aria-label="Back"
        >
          <ChevronLeft className="size-5" />
        </Button>
      </div>

      {/* Avatar + name */}
      <div className="px-5 -mt-10 flex items-end gap-3">
        <div
          className="size-20 rounded-full border-4 flex-shrink-0"
          style={{
            backgroundColor: '#6366F1',
            borderColor: 'hsl(var(--background))',
          }}
          aria-hidden
        />
        <div className="flex-1 min-w-0 pb-1">
          <div className="text-lg font-semibold leading-tight">MarineKids</div>
          <div className="text-[12px] text-muted-foreground">
            @marinekids · 2.3k followers
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="px-4 grid grid-cols-2 gap-2 mt-1">
        <Button
          variant={following ? 'secondary' : 'default'}
          className="h-10 rounded-full"
          onClick={() => setFollowing((v) => !v)}
        >
          {following ? 'Following' : 'Follow'}
        </Button>
        <Button variant="secondary" className="h-10 rounded-full">
          Assign trust
        </Button>
      </div>

      {/* Bio */}
      <p className="px-5 text-[12px] text-muted-foreground leading-relaxed">
        Ocean science for little explorers. 4+ years old. New video every
        Thursday. 🐙
      </p>

      {/* Tabs */}
      <div className="px-4 flex items-center gap-2 mt-1" role="tablist">
        <TabButton active={tab === 'videos'} onClick={() => setTab('videos')}>
          Videos
        </TabButton>
        <TabButton active={tab === 'about'} onClick={() => setTab('about')}>
          About
        </TabButton>
      </div>

      {/* Tab content */}
      {tab === 'videos' ? (
        <div className="px-4 grid grid-cols-3 gap-2">
          {[
            'linear-gradient(135deg, #334155, #1E293B)',
            'linear-gradient(135deg, #475569, #1E293B)',
            'linear-gradient(135deg, #0891B2, #164E63)',
            'linear-gradient(135deg, #7C3AED, #4C1D95)',
            'linear-gradient(135deg, #F97316, #9A3412)',
            'linear-gradient(135deg, #22C55E, #166534)',
          ].map((grad, i) => (
            <button
              key={i}
              type="button"
              onClick={() => nav(`/parent/video/profile-${i}`)}
              className="aspect-square rounded-lg overflow-hidden"
              style={{ background: grad }}
              aria-label={`Video ${i + 1}`}
            />
          ))}
        </div>
      ) : (
        <div className="px-5 flex flex-col gap-3 text-[13px] leading-relaxed">
          <Fact label="Joined" value="Jan 2024" />
          <Fact label="Videos" value="42" />
          <Fact label="Languages" value="English, Spanish" />
          <Fact label="Links" value="marinekids.example" />
        </div>
      )}
    </div>
  );
}

function TabButton({
  active, onClick, children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'h-8 px-4 rounded-full text-[12px] font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-card text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground font-semibold">
        {label}
      </span>
      <span>{value}</span>
    </div>
  );
}
