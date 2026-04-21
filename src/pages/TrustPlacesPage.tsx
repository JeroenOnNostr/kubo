import { RelayListManager } from '@/components/RelayListManager';
import { BlossomSettings } from '@/components/BlossomSettings';
import { NoKidSelected } from '@/components/NoKidSelected';
import { TrustHeader } from '@/pages/TrustPeoplePage';
import { useSelectedKid } from '@/hooks/useSelectedKid';

/**
 * /parent/trust/places — Places tab of the Trust domain.
 *
 * The active Nostr signer IS the kid (parent picks via the top-right gear
 * dropdown), so Ditto's <RelayListManager /> and <BlossomSettings /> publish
 * under the kid's pubkey as kind:10002 (NIP-65) and kind:10063 (BUD-03).
 *
 * Extend / Interact / View trust-level semantics are intentionally deferred
 * to KUBO-013; this screen is data-wiring only.
 */
export function TrustPlacesPage() {
  const kid = useSelectedKid();

  if (!kid) {
    return <NoKidSelected title="Trust · Places" />;
  }

  return (
    <div className="flex flex-col gap-3 px-4 pt-2 pb-6">
      <TrustHeader active="places" />
      <p className="text-[11px] text-muted-foreground px-1">
        {`Relays and file servers for ${kid.displayName}. Changes publish under their Nostr key.`}
      </p>

      <div className="flex flex-col gap-4">
        <RelayListManager />
        <BlossomSettings />
      </div>
    </div>
  );
}
