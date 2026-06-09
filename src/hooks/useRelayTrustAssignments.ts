import { useCallback, useMemo } from 'react';

import { useAppContext } from '@/hooks/useAppContext';
import { useToast } from '@/hooks/useToast';
import {
  useKuboTeppPublishPermission,
  useKuboTeppPublishState,
} from '@/hooks/useKuboTeppPublish';
import {
  KIND_PERMISSION_INTERACTION_NPUB_A,
  KIND_PERMISSION_INTERACTION_RELAY,
  KIND_PERMISSION_VIEW_NPUB_A,
  KIND_PERMISSION_VIEW_RELAY,
} from '@/lib/tepp/kinds';
import type { PermissionRef } from '@/lib/tepp/types';

import {
  getFamilySnapshot,
  recordTeppPermissionId,
  useKuboFamily,
  type KuboTrustLevel,
} from './useKuboFamily';
import type { KuboFamily } from './useKuboFamily';
import { normalizeRelayUrl } from '@/lib/relayUrl';

/** Mirror of the helper in useTrustAssignments — keep both in sync. */
function buildPublicPermissionRefs(
  family: KuboFamily | null,
  kidPubkey: string,
): PermissionRef[] {
  const ids = family?.teppLatestPermissionIds?.[kidPubkey];
  if (!ids) return [];
  const refs: PermissionRef[] = [];
  if (ids.view) refs.push({ id: ids.view, kind: KIND_PERMISSION_VIEW_NPUB_A });
  if (ids.interact) refs.push({ id: ids.interact, kind: KIND_PERMISSION_INTERACTION_NPUB_A });
  if (ids.extend && ids.extend !== ids.interact) {
    refs.push({ id: ids.extend, kind: KIND_PERMISSION_INTERACTION_NPUB_A });
  }
  if (ids.viewRelay) refs.push({ id: ids.viewRelay, kind: KIND_PERMISSION_VIEW_RELAY });
  if (ids.interactRelay) refs.push({ id: ids.interactRelay, kind: KIND_PERMISSION_INTERACTION_RELAY });
  return refs;
}

// Delegates to the shared atomic mutator (reads latest + merges) so it
// preserves the relayTrustAssignments entry setRelayTrustLevel just wrote
// instead of clobbering it with a stale snapshot. (KUBO-134 / KUBO-135)
async function recordRelayPermissionEventId(
  kidPubkey: string,
  tier: 'viewRelay' | 'interactRelay',
  eventId: string,
): Promise<KuboFamily | null> {
  return recordTeppPermissionId(kidPubkey, tier, eventId);
}

export interface RelayTrustAssignmentsApi {
  get: (relayUrl: string) => KuboTrustLevel | undefined;
  setLevel: (relayUrl: string, level: KuboTrustLevel) => Promise<void>;
  clear: (relayUrl: string) => Promise<void>;
  /** All assigned URLs for this kid, for list/page rendering. */
  assigned: { [relayUrl: string]: KuboTrustLevel };
}

/**
 * Scoped read/write view of relay trust assignments for a single kid.
 * Mirrors useTrustAssignments but keys by normalized relay URL (wss://…/)
 * instead of pubkey. Visual-only assignment — does not influence routing
 * or content selection (TEPP, future).
 *
 * When `kidPubkey` is undefined, `get` returns undefined, `assigned` is
 * empty, and the mutators throw. Callers should guard on useSelectedKid().
 */
export function useRelayTrustAssignments(
  kidPubkey: string | undefined,
): RelayTrustAssignmentsApi {
  const { family, setRelayTrustLevel, clearRelayTrustLevel } = useKuboFamily();
  const { config } = useAppContext();
  const { toast } = useToast();
  const featureTepp = !!config.feedSettings.featureTepp;
  const publishPermission = useKuboTeppPublishPermission(kidPubkey);
  const publishState = useKuboTeppPublishState(kidPubkey);

  const assigned = useMemo(() => {
    if (!kidPubkey) return {};
    return family?.relayTrustAssignments?.[kidPubkey] ?? {};
  }, [kidPubkey, family?.relayTrustAssignments]);

  const get = useCallback(
    (relayUrl: string): KuboTrustLevel | undefined => {
      const url = normalizeRelayUrl(relayUrl);
      return url ? assigned[url] : undefined;
    },
    [assigned],
  );

  const setLevel = useCallback(
    async (relayUrl: string, level: KuboTrustLevel) => {
      if (!kidPubkey) throw new Error('useRelayTrustAssignments: no kid selected');
      const url = normalizeRelayUrl(relayUrl);
      if (!url) throw new Error('useRelayTrustAssignments: invalid relay URL');
      await setRelayTrustLevel(kidPubkey, url, level);

      if (!featureTepp) return;
      // Relay-extend not yet supported; spec covers extend on relay-list via
      // NIP-11 ownership which the v0.1 PoC parks. Fall back to interact for
      // Kubo-tier 'extend' on relays — the localStorage tier pill still shows extend.
      const targetKind =
        level === 'view' ? KIND_PERMISSION_VIEW_RELAY : KIND_PERMISSION_INTERACTION_RELAY;
      // Read post-write snapshot. Closure-captured `assigned` is the
      // pre-write view, so it omits same-tier entries written this session.
      const fresh =
        getFamilySnapshot()?.relayTrustAssignments?.[kidPubkey] ?? {};
      const sameTierExisting = Object.entries(fresh)
        .filter(([u, tier]) =>
          tier === level &&
          u !== url &&
          (level === 'extend' ? false : true),
        )
        .map(([u]) => u);

      try {
        const permissionEvent = await publishPermission.mutateAsync({
          kind: targetKind,
          dIdentifier: `${kidPubkey}:${level === 'extend' ? 'interact' : level}:relay`,
          relayItems: [...sameTierExisting, url],
        });
        const tier: 'viewRelay' | 'interactRelay' =
          level === 'view' ? 'viewRelay' : 'interactRelay';
        const nextFamily = await recordRelayPermissionEventId(
          kidPubkey,
          tier,
          permissionEvent.id,
        );
        if (nextFamily) {
          await publishState.mutateAsync({
            publicPermissions: buildPublicPermissionRefs(nextFamily, kidPubkey),
          });
        }
      } catch (err) {
        toast({
          title: 'TEPP publish failed',
          description: err instanceof Error ? err.message : String(err),
          variant: 'destructive',
        });
      }
    },
    [kidPubkey, setRelayTrustLevel, featureTepp, publishPermission, publishState, toast],
  );

  const clear = useCallback(
    async (relayUrl: string) => {
      if (!kidPubkey) throw new Error('useRelayTrustAssignments: no kid selected');
      const url = normalizeRelayUrl(relayUrl);
      if (!url) return;
      // Read previousLevel from the latest snapshot BEFORE the clear write.
      const previousLevel =
        getFamilySnapshot()?.relayTrustAssignments?.[kidPubkey]?.[url];
      await clearRelayTrustLevel(kidPubkey, url);

      if (!featureTepp || !previousLevel || previousLevel === 'extend') return;
      const targetKind =
        previousLevel === 'view'
          ? KIND_PERMISSION_VIEW_RELAY
          : KIND_PERMISSION_INTERACTION_RELAY;
      // Read post-write snapshot to compute the surviving same-tier list.
      const fresh =
        getFamilySnapshot()?.relayTrustAssignments?.[kidPubkey] ?? {};
      const sameTierRemaining = Object.entries(fresh)
        .filter(([u, tier]) => tier === previousLevel && u !== url)
        .map(([u]) => u);
      try {
        const permissionEvent = await publishPermission.mutateAsync({
          kind: targetKind,
          dIdentifier: `${kidPubkey}:${previousLevel}:relay`,
          relayItems: sameTierRemaining,
        });
        const tier: 'viewRelay' | 'interactRelay' =
          previousLevel === 'view' ? 'viewRelay' : 'interactRelay';
        const nextFamily = await recordRelayPermissionEventId(
          kidPubkey,
          tier,
          permissionEvent.id,
        );
        if (nextFamily) {
          await publishState.mutateAsync({
            publicPermissions: buildPublicPermissionRefs(nextFamily, kidPubkey),
          });
        }
      } catch (err) {
        toast({
          title: 'TEPP publish failed',
          description: err instanceof Error ? err.message : String(err),
          variant: 'destructive',
        });
      }
    },
    [kidPubkey, clearRelayTrustLevel, featureTepp, publishPermission, publishState, toast],
  );

  return { get, setLevel, clear, assigned };
}
