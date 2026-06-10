import { useMemo } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';

import { useKuboTeppConstruct } from '@/hooks/useKuboTeppConstruct';
import { useSelectedKid } from '@/hooks/useSelectedKid';
import { evaluateEvent } from '@/lib/tepp/evaluate';
import type { Construct, FullEventVerdict, ReferenceLayer } from '@/lib/tepp/types';
import {
  getCachedVerdict,
  setCachedVerdict,
  timeBucketedFingerprint,
} from '@/lib/tepp-adapters/verdictCache';

/**
 * Per-author TEPP verdict for the active kid's construct. Sibling to
 * `useKuboTeppEvaluateEvent` but evaluates a synthesized stand-in event
 * authored by `pubkey` — so the trust UI can dim users who are blacklisted,
 * globally restricted, or otherwise denied at the construct level even when
 * the parent has assigned them a local trust tier.
 *
 * Pass-through (`{ visible: true }`) when the flag is off, no kid is selected,
 * or no construct is loaded — preserves legacy behaviour for the trust pages.
 */
export interface KuboTeppAuthorVerdict {
  /** False when the author is blocked by blacklist, global restriction, or no admission. */
  visible: boolean;
  reason?: string;
  layer?: ReferenceLayer | 'global' | 'pre-fetch';
  raw?: FullEventVerdict;
}

const PASS_THROUGH: KuboTeppAuthorVerdict = { visible: true };

export function useKuboTeppEvaluateAuthor(
  pubkey: string | undefined,
  /** Override the active kid (defaults to `useSelectedKid()`). */
  kidPubkeyOverride?: string,
): KuboTeppAuthorVerdict {
  const selectedKid = useSelectedKid();
  const kidPubkey = kidPubkeyOverride ?? selectedKid?.pubkey;
  const { construct, fingerprint, loading } = useKuboTeppConstruct(kidPubkey);

  return useMemo<KuboTeppAuthorVerdict>(() => {
    if (!pubkey) return PASS_THROUGH;
    if (loading) return PASS_THROUGH;
    if (!construct || !fingerprint) return PASS_THROUGH;
    return evaluateAuthorWithCache(pubkey, construct, fingerprint);
  }, [pubkey, construct, fingerprint, loading]);
}

function evaluateAuthorWithCache(
  pubkey: string,
  construct: Construct,
  fingerprint: string,
): KuboTeppAuthorVerdict {
  // Synthetic id keeps this distinct from real-event verdict cache entries.
  const cacheKey = `author:${pubkey.toLowerCase()}`;
  // KUBO-175: a timed global restriction can flip an author verdict over time.
  const cacheFp = timeBucketedFingerprint(fingerprint, construct);
  let inbound = getCachedVerdict<FullEventVerdict>(cacheFp, cacheKey, 'incoming');
  if (!inbound) {
    const draft = synthesizeAuthorEvent(pubkey);
    inbound = evaluateEvent(
      draft as unknown as Parameters<typeof evaluateEvent>[0],
      construct,
      'incoming',
    );
    // KUBO-175: never cache a `pending` verdict — a pending result is an
    // unresolved reference, not a decision; caching it would pin a transient
    // state. Mirrors the guard in useKuboTeppEvaluateEvent.
    if (inbound.result !== 'pending') {
      setCachedVerdict(cacheFp, cacheKey, 'incoming', inbound);
    }
  }

  const visible =
    inbound.result === 'permit-interaction' ||
    inbound.result === 'permit-view-only' ||
    inbound.result === 'permit-with-redactions';

  return {
    visible,
    reason: visible ? undefined : inbound.message,
    layer: deriveLayer(inbound),
    raw: inbound,
  };
}

function synthesizeAuthorEvent(pubkey: string): NostrEvent {
  return {
    id: '0'.repeat(64),
    sig: '0'.repeat(128),
    pubkey: pubkey.toLowerCase(),
    kind: 1,
    content: '',
    tags: [],
    created_at: Math.floor(Date.now() / 1000),
  };
}

function deriveLayer(v: FullEventVerdict): KuboTeppAuthorVerdict['layer'] {
  if (typeof v.decidingIndex === 'number') {
    const ref = v.references[v.decidingIndex];
    return ref?.layer;
  }
  return undefined;
}
