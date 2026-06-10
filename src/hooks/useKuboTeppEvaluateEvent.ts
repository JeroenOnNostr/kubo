import { useMemo } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import type { Event as NostrToolsEvent } from 'nostr-tools/core';

import { useKuboTeppConstruct } from '@/hooks/useKuboTeppConstruct';
import { useTeppReferenceCache } from '@/hooks/useTeppReferenceCache';
import { evaluateEvent } from '@/lib/tepp/evaluate';
import type { Construct, FullEventVerdict, ReferenceLayer } from '@/lib/tepp/types';
import {
  getCachedVerdict,
  setCachedVerdict,
  timeBucketedFingerprint,
} from '@/lib/tepp-adapters/verdictCache';

/**
 * Convenience verdict shape consumed by the action bar and feed filter.
 * `visible` answers "can this event be shown at all?"
 * `canInteract` answers "can the kid reply / repost / react / zap with it?"
 */
export interface KuboTeppEventVerdict {
  visible: boolean;
  canInteract: boolean;
  reason?: string;
  layer?: ReferenceLayer | 'global' | 'pre-fetch';
  /** Underlying evaluator result for diagnostics. Null when no construct loaded. */
  raw?: FullEventVerdict;
}

const PASS_THROUGH: KuboTeppEventVerdict = { visible: true, canInteract: true };
const NULL_PASS: KuboTeppEventVerdict = { visible: true, canInteract: true };

/**
 * Evaluate an event against the active kid's construct. When the flag is off
 * or no construct is loaded, returns a pass-through verdict so the calling
 * filter/render path is a no-op (existing behaviour preserved).
 *
 * The event's reference closure (its reply parent / quoted note / etc.) is
 * pre-fetched so the evaluator returns a concrete verdict rather than
 * `pending`. While that closure is loading — or a reference can't be fetched —
 * we fail open (visible + interactable); only a concrete `deny` restricts.
 *
 * Memoized via the module-level verdict cache, keyed
 * `(constructFingerprint, eventId, direction)`. Cache hits dodge the
 * (relatively expensive) reference-walk in `evaluateEvent`.
 */
export function useKuboTeppEvaluateEvent(
  event: NostrEvent | undefined,
  kidPubkey: string | undefined,
): KuboTeppEventVerdict {
  const { construct, fingerprint, loading } = useKuboTeppConstruct(kidPubkey);

  const seeds = useMemo(() => (event ? [event] : []), [event]);
  const { cache, isResolving } = useTeppReferenceCache(
    seeds,
    fingerprint,
    !!(event && construct && fingerprint),
  );

  return useMemo<KuboTeppEventVerdict>(() => {
    if (!event) return NULL_PASS;
    if (loading || isResolving) {
      // Don't deny while we're still fetching the construct or the event's
      // reference closure — would flicker / wrongly restrict.
      return NULL_PASS;
    }
    if (!construct || !fingerprint) {
      // No construct → flag-off, no kid, or no association on this device.
      // Pass-through so legacy behaviour wins.
      return PASS_THROUGH;
    }
    return evaluateWithCache(event, construct, fingerprint, cache);
  }, [event, construct, fingerprint, loading, isResolving, cache]);
}

function evaluateWithCache(
  event: NostrEvent,
  construct: Construct,
  fingerprint: string,
  eventCache: Map<string, NostrEvent>,
): KuboTeppEventVerdict {
  const evalOpts = {
    eventCache: eventCache as unknown as Map<string, NostrToolsEvent>,
  };
  // KUBO-175: when the construct has timed restrictions, fold a 15-min time
  // bucket into the cache key so a verdict computed inside one time window
  // stops being served once the clock crosses into the next bucket.
  const cacheFp = timeBucketedFingerprint(fingerprint, construct);
  // We need both directions to compute `visible` and `canInteract` — cache them separately.
  let inbound = getCachedVerdict<FullEventVerdict>(cacheFp, event.id, 'incoming');
  if (!inbound) {
    inbound = evaluateEvent(
      event as unknown as Parameters<typeof evaluateEvent>[0],
      construct,
      'incoming',
      evalOpts,
    );
    if (inbound.result !== 'pending') {
      setCachedVerdict(cacheFp, event.id, 'incoming', inbound);
    }
  }
  let outbound = getCachedVerdict<FullEventVerdict>(cacheFp, event.id, 'outgoing');
  if (!outbound) {
    outbound = evaluateEvent(
      event as unknown as Parameters<typeof evaluateEvent>[0],
      construct,
      'outgoing',
      evalOpts,
    );
    if (outbound.result !== 'pending') {
      setCachedVerdict(cacheFp, event.id, 'outgoing', outbound);
    }
  }

  // Fail open on `pending` (reference unavailable). Hide/restrict only on a
  // concrete `deny`.
  const visible = inbound.result !== 'deny';
  const canInteract = outbound.result !== 'deny';

  // Surface the message from whichever direction actually restricted, so the
  // "Ask to interact" CTA shows the interaction denial — not the (passing)
  // visibility message.
  const reason = !visible
    ? inbound.message
    : !canInteract
      ? outbound.message
      : undefined;

  // Surface the raw verdict from whichever direction actually decided the
  // outcome (KUBO-175): the visibility (inbound) verdict when hidden, otherwise
  // the interaction (outbound) verdict — not unconditionally inbound.
  const deciding = !visible ? inbound : outbound;

  return {
    visible,
    canInteract,
    reason,
    layer: deriveLayer(deciding),
    raw: deciding,
  };
}

function deriveLayer(v: FullEventVerdict): KuboTeppEventVerdict['layer'] {
  if (typeof v.decidingIndex === 'number') {
    const ref = v.references[v.decidingIndex];
    return ref?.layer;
  }
  return undefined;
}
