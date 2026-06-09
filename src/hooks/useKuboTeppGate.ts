import { useCallback } from 'react';
import type { EventTemplate } from 'nostr-tools/pure';
import type { Event as NostrToolsEvent } from 'nostr-tools/core';
import type { NostrEvent } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useKuboFamily } from '@/hooks/useKuboFamily';
import { useKuboTeppConstruct } from '@/hooks/useKuboTeppConstruct';
import { evaluateEvent } from '@/lib/tepp/evaluate';
import { prefetchReferenceClosure } from '@/lib/tepp-adapters/referenceClosure';
import type { Construct, FullEventVerdict } from '@/lib/tepp/types';

/**
 * Outbound TEPP gate for kid-authored events. Returns a `gate(template)`
 * function the publish path can call (and await) before signing.
 *
 * When the active user is a kid AND a construct is loaded, the template's
 * reference closure is pre-fetched and the template is fed through
 * `evaluateEvent(..., 'outgoing')`. On a concrete deny the gate throws a
 * `TeppDeniedError` carrying the verdict + offending references for the UI
 * to surface. A `pending` verdict (a referenced event we couldn't fetch)
 * fails OPEN — a kid is not blocked from replying just because the reply's
 * parent couldn't be loaded.
 *
 * When inactive (flag off, no kid, no construct), `gate()` is a no-op.
 */
export class TeppDeniedError extends Error {
  verdict: FullEventVerdict;
  layer?: string;
  offendingReferences: string[];
  constructor(verdict: FullEventVerdict) {
    super(`TEPP denied this action: ${verdict.message}`);
    this.name = 'TeppDeniedError';
    this.verdict = verdict;
    this.layer =
      typeof verdict.decidingIndex === 'number'
        ? verdict.references[verdict.decidingIndex]?.layer
        : undefined;
    this.offendingReferences = verdict.references
      .filter((r) => r.outcome === 'deny')
      .map((r) => r.raw);
  }
}

export interface KuboTeppGate {
  /** True when the gate is actively evaluating; false when inactive (no-op). */
  enabled: boolean;
  /**
   * Throws `TeppDeniedError` if the construct denies this template; resolves
   * silently otherwise (including when the gate is inactive). Awaited by the
   * publish path so the reference closure can be fetched first.
   */
  gate: (template: EventTemplate | Omit<NostrEvent, 'id' | 'sig'>) => Promise<void>;
}

export function useKuboTeppGate(): KuboTeppGate {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { family } = useKuboFamily();
  const activePubkey = user?.pubkey;
  const isKid = !!activePubkey && !!family?.kids.some((k) => k.pubkey === activePubkey);
  const { construct, fingerprint } = useKuboTeppConstruct(isKid ? activePubkey : undefined);

  const enabled = !!(isKid && construct && fingerprint);

  const gate = useCallback<KuboTeppGate['gate']>(
    async (template) => {
      if (!enabled || !construct) return;
      const draft = templateToEvent(template, activePubkey ?? '');

      // Pre-fetch the draft's reference closure so a reply/quote resolves to a
      // concrete admit/deny instead of `pending`. Failure to fetch fails open.
      let eventCache: Map<string, NostrEvent> | undefined;
      try {
        const { cache } = await prefetchReferenceClosure([draft], nostr.query.bind(nostr));
        eventCache = cache;
      } catch {
        eventCache = undefined;
      }

      const verdict = evaluateEvent(
        draft as unknown as Parameters<typeof evaluateEvent>[0],
        construct as Construct,
        'outgoing',
        eventCache
          ? { eventCache: eventCache as unknown as Map<string, NostrToolsEvent> }
          : {},
      );
      // Only block on a concrete deny. `pending` (unfetchable reference) fails
      // open so relay gaps don't silently stop a kid from posting.
      if (verdict.result === 'deny') {
        throw new TeppDeniedError(verdict);
      }
    },
    [enabled, construct, activePubkey, nostr],
  );

  return { enabled, gate };
}

/**
 * Synthesise a fully-formed (unsigned) NostrEvent from a template so the
 * evaluator's reference walker has a real event shape to operate on. The
 * id/sig fields are placeholders — they don't affect reference extraction.
 */
function templateToEvent(
  template: EventTemplate | Omit<NostrEvent, 'id' | 'sig'>,
  pubkey: string,
): NostrEvent {
  const created_at = (template as { created_at?: number }).created_at ?? Math.floor(Date.now() / 1000);
  return {
    id: '0'.repeat(64),
    sig: '0'.repeat(128),
    pubkey,
    kind: template.kind,
    content: template.content ?? '',
    tags: template.tags ?? [],
    created_at,
  };
}
