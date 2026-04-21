import { useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

import { RelayListManager } from '@/components/RelayListManager';
import { BlossomSettings } from '@/components/BlossomSettings';
import { TrustHeader } from '@/pages/TrustPeoplePage';
import { useEditAsKid } from '@/hooks/useEditAsKid';
import { useKidDisplayName } from '@/hooks/useKidDisplayName';

/**
 * /parent/kid/:id/trust/places — Places tab of the Trust domain.
 *
 * Reuses Ditto's <RelayListManager /> and <BlossomSettings /> under the kid's
 * signer via `useEditAsKid`. Writes publish under the kid's pubkey as
 * kind:10002 (NIP-65) and kind:10063 (BUD-03).
 *
 * Extend / Interact / View trust-level semantics are intentionally deferred
 * to KUBO-013; this screen is data-wiring only.
 */
export function TrustPlacesPage() {
  const { id = '' } = useParams<{ id: string }>();
  const kidName = useKidDisplayName(id);
  const edit = useEditAsKid(id);

  if (edit.status === 'unavailable') {
    return (
      <div className="flex flex-col gap-3 px-4 pt-2 pb-6">
        <TrustHeader kidId={id} active="places" />
        <p className="px-1 text-sm text-muted-foreground">
          {`${kidName || "This kid"}'s key isn't stored on this device, so relays and file servers can't be edited here.`}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-4 pt-2 pb-6">
      <TrustHeader kidId={id} active="places" />
      <p className="text-[11px] text-muted-foreground px-1">
        {`Relays and file servers for ${kidName}. Changes publish under their Nostr key.`}
      </p>

      {edit.status === 'ready' ? (
        <div className="flex flex-col gap-4">
          <RelayListManager />
          <BlossomSettings />
        </div>
      ) : (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      )}
    </div>
  );
}
