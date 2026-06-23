import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNostrLogin } from '@nostrify/react/login';
import { nip19 } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';
import type { Event as NostrToolsEvent } from 'nostr-tools/core';
import { useNostr } from '@nostrify/react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { NoKidSelected } from '@/components/NoKidSelected';
import { TrustHeader } from '@/pages/TrustPeoplePage';
import { useAppContext } from '@/hooks/useAppContext';
import { useKuboFamily } from '@/hooks/useKuboFamily';
import { useKuboTeppConstruct } from '@/hooks/useKuboTeppConstruct';
import { useParentSigner } from '@/hooks/useParentSigner';
import { useSelectedKid } from '@/hooks/useSelectedKid';
import { useKidSigner } from '@/lib/tepp-adapters/useKidSigner';
import { prefetchReferenceClosure } from '@/lib/tepp-adapters/referenceClosure';
import {
  clearVerdictCache,
  verdictCacheSize,
} from '@/lib/tepp-adapters/verdictCache';
import {
  readTeppAuditLog,
  type TeppAuditEntry,
} from '@/lib/tepp-adapters/teppAuditLog';
import { evaluateEvent } from '@/lib/tepp/evaluate';
import {
  KIND_PERMISSION_INTERACTION_NPUB_A,
  KIND_PERMISSION_INTERACTION_NPUB_B,
  KIND_PERMISSION_INTERACTION_RELAY,
  KIND_PERMISSION_INTERACTION_EVENT,
  KIND_PERMISSION_VIEW_NPUB_A,
  KIND_PERMISSION_VIEW_NPUB_B,
  KIND_PERMISSION_VIEW_RELAY,
  KIND_PERMISSION_VIEW_EVENT,
} from '@/lib/tepp/kinds';
import type { Construct, FullEventVerdict } from '@/lib/tepp/types';

/**
 * /parent/trust/diagnostics — read-only "what does TEPP think?" surface for
 * the selected kid. Renders the live state of the construct, recent audit
 * log, and a tiny event-id checker for "this person should be on my view
 * list, why isn't their post showing?" debugging.
 */
export function ParentTrustDiagnosticsPage() {
  const kid = useSelectedKid();
  const { family } = useKuboFamily();
  const { config } = useAppContext();
  const { reason: parentReason } = useParentSigner();
  const { user: kidUser, reason: kidSignerReason } = useKidSigner(kid?.pubkey);
  const { logins } = useNostrLogin();
  const queryClient = useQueryClient();
  const featureTepp = !!config.feedSettings.featureTepp;

  const construct = useKuboTeppConstruct(kid?.pubkey);
  // KUBO-175: the audit log is an append-only module singleton that grows as
  // TEPP events get signed/published. The old `[]` deps pinned this to the
  // first render, so newly-logged entries never showed. Re-read whenever the
  // construct changes (every publish that mutates the construct also appends an
  // audit entry) and whenever the selected kid changes.
  const auditLog = useMemo(
    () => readTeppAuditLog().slice(-50).reverse(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kid?.pubkey, construct.fingerprint, construct.loading],
  );

  if (!kid) {
    return <NoKidSelected title="Trust · Diagnostics" />;
  }

  const activePubkey = logins[0]?.pubkey;
  const activeIsKid = activePubkey === kid.pubkey;
  const activeIsParent = activePubkey === family?.parentPubkey;

  return (
    <div className="flex flex-col gap-4 px-4 pt-2 pb-6">
      <TrustHeader active="people" />

      <h1 className="text-base font-semibold">TEPP diagnostics · {kid.displayName}</h1>

      {/* Flag */}
      <Section title="Feature flag">
        <Row label="featureTepp" value={featureTepp ? 'ON' : 'OFF'} />
        {!featureTepp && (
          <p className="text-[11px] text-muted-foreground">
            TEPP is off. Trust assignments stay on this device only and the kid
            feed is not filtered. Toggle from /parent/kid-settings.
          </p>
        )}
      </Section>

      {/* Active user */}
      <Section title="Active signer">
        <Row label="active pubkey" value={activePubkey ?? '(none)'} mono truncate />
        <Row
          label="role"
          value={
            activeIsKid
              ? 'kid (filtering applies on the kid feed)'
              : activeIsParent
                ? 'parent (kid feed filtering does NOT apply here)'
                : 'someone else'
          }
        />
        {!activeIsKid && (
          <p className="text-[11px] text-muted-foreground">
            TEPP filtering only applies when the active signer is the kid. To
            see the filtered feed, switch to "{kid.displayName}" via the kid
            switcher in the top-right.
          </p>
        )}
        {parentReason && (
          <Row label="parent signer status" value={parentReason} />
        )}
        {kidSignerReason && (
          <Row label="kid signer status" value={kidSignerReason} />
        )}
        {kidSignerReason === 'kid-not-logged-in' && (
          <p className="text-[11px] text-amber-600 dark:text-amber-500">
            ⚠️ The kid is in your family record but has no matching login on this
            device. Their TEPP association event (kind 17700) cannot be
            published until the kid is logged in at least once via the kid
            switcher. Without it, the construct stays at "no-association" and
            no filtering happens.
          </p>
        )}
        {!kidUser && !kidSignerReason && (
          <p className="text-[11px] text-muted-foreground">
            kidUser resolved without a stored reason — diagnostic edge case.
          </p>
        )}
      </Section>

      {/* Migration */}
      <Section title="Migration">
        <Row
          label="teppMigratedAt"
          value={
            family?.teppMigratedAt
              ? new Date(family.teppMigratedAt).toISOString()
              : 'not yet completed'
          }
        />
        {family?.teppMigrationPlan ? (
          <div>
            <Row
              label="plan started"
              value={new Date(family.teppMigrationPlan.startedAt).toISOString()}
            />
            <div className="mt-2 grid gap-1">
              {family.teppMigrationPlan.steps
                .filter((s) => s.kidPubkey === kid.pubkey)
                .map((s) => (
                  <div
                    key={s.id}
                    className="text-[11px] flex justify-between gap-2 font-mono"
                  >
                    <span>step #{s.order}</span>
                    <span className={s.acked ? 'text-emerald-600' : 'text-amber-600'}>
                      {s.acked ? 'acked' : 'pending'}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        ) : family?.teppMigratedAt ? null : (
          <p className="text-[11px] text-muted-foreground">
            No migration plan persisted. Will run automatically next time the
            flag is on with kids in the family record.
          </p>
        )}
      </Section>

      {/* Construct */}
      <Section title="Construct">
        {construct.loading ? (
          <p className="text-[11px] text-muted-foreground">loading…</p>
        ) : (
          <>
            <Row
              label="phase"
              value={
                construct.construct
                  ? 'loaded'
                  : (construct.reason ?? 'unknown')
              }
            />
            {construct.errorMessage && (
              <Row label="error" value={construct.errorMessage} />
            )}
            {construct.construct && (
              <ConstructDetails construct={construct.construct} />
            )}
            {construct.fingerprint && (
              <Row label="fingerprint" value={construct.fingerprint} mono truncate />
            )}
          </>
        )}
        <div className="flex gap-2 mt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              clearVerdictCache();
              queryClient.invalidateQueries({
                queryKey: ['kubo-tepp-construct', kid.pubkey],
              });
            }}
          >
            Refetch construct
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              clearVerdictCache();
            }}
          >
            Clear verdict cache ({verdictCacheSize()})
          </Button>
        </div>
      </Section>

      {/* Test event */}
      <TestEventPanel construct={construct.construct} />

      {/* Audit log */}
      <Section title={`Audit log (last ${auditLog.length})`}>
        {auditLog.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">empty</p>
        ) : (
          <div className="grid gap-1 font-mono text-[10.5px]">
            {auditLog.map((entry, i) => (
              <AuditRow key={`${entry.ts}-${i}`} entry={entry} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5">
      <h2 className="text-sm font-semibold mb-1.5">{title}</h2>
      <div className="grid gap-1">{children}</div>
    </section>
  );
}

function Row({
  label,
  value,
  mono,
  truncate,
}: {
  label: string;
  value: string;
  mono?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[11px]">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span
        className={[
          mono ? 'font-mono' : '',
          truncate ? 'truncate' : '',
          'text-right',
        ].filter(Boolean).join(' ')}
      >
        {value}
      </span>
    </div>
  );
}

function ConstructDetails({ construct }: { construct: Construct }) {
  const tiers = useMemo(() => groupEntriesByTier(construct), [construct]);

  return (
    <div className="grid gap-1">
      <Row label="subject" value={shortenPubkey(construct.subject)} mono />
      <Row label="guardians" value={String(construct.guardians.length)} />
      <Row label="entries (total)" value={String(construct.entries.length)} />
      <Row label="view (8712)" value={String(tiers.viewNpubs.length)} />
      <Row label="interact (8710)" value={String(tiers.interactNpubs.length)} />
      <Row label="view-relay (8715)" value={String(tiers.viewRelays.length)} />
      <Row label="interact-relay (8714)" value={String(tiers.interactRelays.length)} />
      <Row label="event-list view (8717)" value={String(tiers.viewEvents.length)} />
      <Row label="event-list interact (8716)" value={String(tiers.interactEvents.length)} />
      {construct.blacklist && (
        <Row
          label="blacklist"
          value={`${construct.blacklist.blockedPubkeys.length} pubkeys, ${construct.blacklist.blockedRelays.length} relays, ${construct.blacklist.blockedEvents.length} events`}
        />
      )}
      {construct.global && (
        <Row label="global restriction" value="present" />
      )}

      {tiers.viewNpubs.length > 0 && (
        <details className="mt-1">
          <summary className="text-[11px] cursor-pointer text-muted-foreground">
            View list ({tiers.viewNpubs.length} pubkeys)
          </summary>
          <ul className="mt-1 grid gap-0.5 font-mono text-[10.5px]">
            {tiers.viewNpubs.map((pk) => (
              <li key={pk}>{shortenPubkey(pk)}</li>
            ))}
          </ul>
        </details>
      )}
      {tiers.interactNpubs.length > 0 && (
        <details className="mt-1">
          <summary className="text-[11px] cursor-pointer text-muted-foreground">
            Interact list ({tiers.interactNpubs.length} pubkeys)
          </summary>
          <ul className="mt-1 grid gap-0.5 font-mono text-[10.5px]">
            {tiers.interactNpubs.map((pk) => (
              <li key={pk}>{shortenPubkey(pk)}</li>
            ))}
          </ul>
        </details>
      )}
      {construct.inertAuditFindings.length > 0 && (
        <details className="mt-1">
          <summary className="text-[11px] cursor-pointer text-amber-600">
            Spec warnings ({construct.inertAuditFindings.length})
          </summary>
          <ul className="mt-1 grid gap-0.5 text-[10.5px] text-amber-600/90">
            {construct.inertAuditFindings.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

interface TieredEntries {
  viewNpubs: string[];
  interactNpubs: string[];
  viewRelays: string[];
  interactRelays: string[];
  viewEvents: string[];
  interactEvents: string[];
}

function groupEntriesByTier(construct: Construct): TieredEntries {
  const out: TieredEntries = {
    viewNpubs: [],
    interactNpubs: [],
    viewRelays: [],
    interactRelays: [],
    viewEvents: [],
    interactEvents: [],
  };
  for (const entry of construct.entries) {
    if (
      entry.kind === KIND_PERMISSION_VIEW_NPUB_A ||
      entry.kind === KIND_PERMISSION_VIEW_NPUB_B
    ) {
      for (const item of entry.items as Array<{ pubkey: string }>) {
        out.viewNpubs.push(item.pubkey);
      }
    } else if (
      entry.kind === KIND_PERMISSION_INTERACTION_NPUB_A ||
      entry.kind === KIND_PERMISSION_INTERACTION_NPUB_B
    ) {
      for (const item of entry.items as Array<{ pubkey: string }>) {
        out.interactNpubs.push(item.pubkey);
      }
    } else if (entry.kind === KIND_PERMISSION_VIEW_RELAY) {
      for (const r of entry.items as string[]) out.viewRelays.push(r);
    } else if (entry.kind === KIND_PERMISSION_INTERACTION_RELAY) {
      for (const r of entry.items as string[]) out.interactRelays.push(r);
    } else if (entry.kind === KIND_PERMISSION_VIEW_EVENT) {
      for (const item of entry.items as Array<{ eventId: string }>) {
        out.viewEvents.push(item.eventId);
      }
    } else if (entry.kind === KIND_PERMISSION_INTERACTION_EVENT) {
      for (const item of entry.items as Array<{ eventId: string }>) {
        out.interactEvents.push(item.eventId);
      }
    }
  }
  return out;
}

function TestEventPanel({ construct }: { construct: Construct | null }) {
  const { nostr } = useNostr();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<{
    direction: 'incoming' | 'outgoing';
    result: FullEventVerdict;
  } | null>(null);

  async function handleRun() {
    setError(null);
    setVerdict(null);
    if (!construct) {
      setError('No construct loaded — fix the construct phase first.');
      return;
    }
    const id = parseEventId(input.trim());
    if (!id) {
      setError('Expected a 64-char hex event id, a nevent1…, or a note1….');
      return;
    }
    setBusy(true);
    try {
      const events: NostrEvent[] = await nostr.query(
        [{ ids: [id], limit: 1 }],
        { signal: AbortSignal.timeout(5000) },
      );
      const event = events[0];
      if (!event) {
        setError('Post not found in any of your places.');
        setBusy(false);
        return;
      }
      // KUBO-175: prefetch the event's reference closure (reply parents, quoted
      // notes, …) so the evaluator can resolve references instead of returning
      // `pending` — without this, any reply/quote always read `pending` here.
      const { cache } = await prefetchReferenceClosure(
        [event],
        (filters, opts) => nostr.query(filters, opts),
        { signal: AbortSignal.timeout(5000) },
      );
      const incoming = evaluateEvent(
        event as unknown as Parameters<typeof evaluateEvent>[0],
        construct,
        'incoming',
        { eventCache: cache as unknown as Map<string, NostrToolsEvent> },
      );
      setVerdict({ direction: 'incoming', result: incoming });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Test event">
      <Label htmlFor="tepp-test-event-id" className="text-[11px] text-muted-foreground">
        Paste a hex event id, nevent1…, or note1… to evaluate it under the
        current construct.
      </Label>
      <Textarea
        id="tepp-test-event-id"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="hex / nevent1 / note1"
        rows={2}
        className="font-mono text-[11px]"
      />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleRun}
          disabled={busy || !construct}
        >
          {busy ? 'Evaluating…' : 'Evaluate (incoming)'}
        </Button>
        {error && <span className="text-[11px] text-destructive">{error}</span>}
      </div>
      {verdict && (
        <div className="mt-2 rounded-md bg-card px-2 py-1.5 grid gap-0.5 text-[11px]">
          <Row label="direction" value={verdict.direction} />
          <Row label="result" value={verdict.result.result} />
          <Row label="message" value={verdict.result.message} />
          {typeof verdict.result.decidingIndex === 'number' && (
            <Row
              label="layer"
              value={
                verdict.result.references[verdict.result.decidingIndex]?.layer ?? '—'
              }
            />
          )}
        </div>
      )}
    </Section>
  );
}

function AuditRow({ entry }: { entry: TeppAuditEntry }) {
  return (
    <div className="grid grid-cols-[6.5rem_3.5rem_1fr] gap-1.5">
      <span className="text-muted-foreground">
        {new Date(entry.ts).toISOString().slice(11, 19)}
      </span>
      <span>kind {entry.kind}</span>
      <span className="truncate">
        {entry.note ? entry.note + ' · ' : ''}
        signer {entry.signerPubkey.slice(0, 8)}…
        {entry.subjectPubkey ? ` → ${entry.subjectPubkey.slice(0, 8)}…` : ''}
      </span>
    </div>
  );
}

function shortenPubkey(pk: string): string {
  if (pk.length < 16) return pk;
  return `${pk.slice(0, 8)}…${pk.slice(-4)}`;
}

function parseEventId(input: string): string | null {
  if (!input) return null;
  if (/^[0-9a-f]{64}$/i.test(input)) return input.toLowerCase();
  try {
    const decoded = nip19.decode(input);
    if (decoded.type === 'note') return decoded.data;
    if (decoded.type === 'nevent') return decoded.data.id;
  } catch {
    // fall through
  }
  return null;
}
