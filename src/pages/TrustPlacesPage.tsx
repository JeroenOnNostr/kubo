import { useParams } from 'react-router-dom';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { TrustLegend } from '@/components/trust/TrustLegend';
import { TrustRow, type TrustLevel } from '@/components/trust/TrustRow';
import { TrustHeader } from '@/pages/TrustPeoplePage';
import { useKidDisplayName } from '@/hooks/useKidDisplayName';

/**
 * /parent/kid/:id/trust/places — Places tab of the Trust domain.
 *
 * Visual only. Placeholder relay list matches contact-sheet screen 10.
 * Kid client read/write routing (Extend/Interact/View semantics for
 * relays) is implemented in the data-layer PR.
 */
type Relay = {
  id: string;
  url: string;
  subtitle: string;
  level: TrustLevel;
  avatar: string;
  avatarBg: string;
};

const RELAYS: Relay[] = [
  { id: 'r1', url: 'relay.damus.io',  subtitle: 'Large public relay', level: 'interact', avatar: 'D', avatarBg: '#1E40AF' },
  { id: 'r2', url: 'relay.primal.net', subtitle: 'Large public relay', level: 'extend',   avatar: 'P', avatarBg: '#7C3AED' },
  { id: 'r3', url: 'nos.lol',          subtitle: 'Community relay',     level: 'view',     avatar: 'N', avatarBg: '#0891B2' },
  { id: 'r4', url: 'relay.kubo.fun',   subtitle: 'Kubo official',       level: 'extend',   avatar: 'K', avatarBg: '#F97316' },
];

export function TrustPlacesPage() {
  const { id = 'ellie' } = useParams<{ id: string }>();
  const kidName = useKidDisplayName(id);

  return (
    <div className="flex flex-col gap-3 px-4 pt-2 pb-6">
      <TrustHeader kidId={id} active="places" />

      <TrustLegend className="mt-1" />
      <p className="text-[11px] text-muted-foreground px-1 -mt-1">
        {`Relays ${kidName} can reach, and how far.`}
      </p>

      <div className="flex flex-col gap-2 mt-1">
        {RELAYS.map((r) => (
          <TrustRow
            key={r.id}
            name={r.url}
            subtitle={r.subtitle}
            level={r.level}
            avatar={r.avatar}
            avatarBg={r.avatarBg}
          />
        ))}
      </div>

      <Button variant="secondary" size="lg" className="w-full h-11 rounded-full mt-2 gap-2">
        <Plus className="size-4" /> Add relay
      </Button>
    </div>
  );
}
