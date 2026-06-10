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

/**
 * Pure helper: split a kid's relay-trust assignment map into the two relay
 * permission lists that actually go on the wire.
 *
 * KUBO-170: the kind-8714 interaction-relay list is published under a SINGLE
 * shared d-tag (`<kid>:interact:relay`), so it must carry the UNION of the
 * `interact` and `extend` tiers — relay `extend` has no distinct on-wire list
 * in the v0.1 PoC (mode-B relay ownership is parked), it folds into 8714 just
 * like the migration does (`teppMigration.ts:175`:
 * `[...groupedRelay.interact, ...groupedRelay.extend]`). The `view` tier maps
 * to the separate kind-8715 list under `<kid>:view:relay`.
 *
 * Every publish of either list — set OR clear — is rebuilt from this helper so
 * a single relay's change never clobbers the rest of its list off the wire.
 */
export function buildRelayUnionItems(assignments: {
  [relayUrl: string]: KuboTrustLevel;
}): { view: string[]; interact: string[] } {
  const view: string[] = [];
  const interact: string[] = [];
  for (const [url, tier] of Object.entries(assignments)) {
    if (tier === 'view') {
      view.push(url);
    } else {
      // 'interact' and 'extend' share the 8714 list.
      interact.push(url);
    }
  }
  return { view, interact };
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
      // Relay-extend not yet supported as a distinct on-wire list; the v0.1
      // PoC parks NIP-11-ownership relay extend, so Kubo-tier 'extend' folds
      // into the 8714 interaction-relay list (the localStorage tier pill still
      // shows extend). KUBO-170: 'view' → 8715, {'interact','extend'} → 8714,
      // and EACH publish rebuilds the whole list from the post-write union so
      // we never clobber the rest of the tier off the wire.
      const isView = level === 'view';
      const targetKind = isView
        ? KIND_PERMISSION_VIEW_RELAY
        : KIND_PERMISSION_INTERACTION_RELAY;
      // Read post-write snapshot. Closure-captured `assigned` is the
      // pre-write view, so it omits the entry written this session.
      const fresh =
        getFamilySnapshot()?.relayTrustAssignments?.[kidPubkey] ?? {};
      const { view, interact } = buildRelayUnionItems(fresh);
      const relayItems = isView ? view : interact;

      try {
        const permissionEvent = await publishPermission.mutateAsync({
          kind: targetKind,
          dIdentifier: `${kidPubkey}:${isView ? 'view' : 'interact'}:relay`,
          relayItems,
        });
        // Ref slot mirrors the migration (teppMigration.ts order 4 →
        // 'interactRelay'): the shared 8714 event is a single replaceable
        // permission event, so interact AND extend record under the one
        // 'interactRelay' slot; 8715 records under 'viewRelay'. There is no
        // distinct 'extendRelay' slot and the state-ref builder
        // (buildPublicPermissionRefs) emits only those two.
        const tier: 'viewRelay' | 'interactRelay' = isView
          ? 'viewRelay'
          : 'interactRelay';
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

      // KUBO-170: an extend relay used to return early here, so its 8714
      // membership stayed admitted on the wire forever (a permanent grant the
      // parent could never revoke). Now we publish the shrunken union for
      // extend exactly as for interact — clearing it is a real revocation.
      if (!featureTepp || !previousLevel) return;
      const isView = previousLevel === 'view';
      const targetKind = isView
        ? KIND_PERMISSION_VIEW_RELAY
        : KIND_PERMISSION_INTERACTION_RELAY;
      // Read post-write snapshot to compute the surviving union for this list.
      // 'view' shrinks the 8715 list; 'interact'/'extend' both shrink the
      // shared 8714 union (clearing an interact relay must keep extend-tier
      // relays in the published union, and vice-versa).
      const fresh =
        getFamilySnapshot()?.relayTrustAssignments?.[kidPubkey] ?? {};
      const { view, interact } = buildRelayUnionItems(fresh);
      const relayItems = isView ? view : interact;
      try {
        const permissionEvent = await publishPermission.mutateAsync({
          kind: targetKind,
          dIdentifier: `${kidPubkey}:${isView ? 'view' : 'interact'}:relay`,
          relayItems,
        });
        // Same single-slot mapping as setLevel: the shared 8714 event records
        // under 'interactRelay' regardless of view-tier extend vs interact.
        const tier: 'viewRelay' | 'interactRelay' = isView
          ? 'viewRelay'
          : 'interactRelay';
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
