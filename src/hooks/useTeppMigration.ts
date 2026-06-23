import { useEffect, useRef } from 'react';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
  useKuboFamily,
  setFamily,
  recordTeppPermissionId,
  readLatest,
  type TeppPermissionTier,
} from '@/hooks/useKuboFamily';
import { fetchPacksByAtags } from '@/hooks/useFollowPacks';
import { MAX_PACK_AUTHORS } from '@/hooks/useKidFeed';
import { useParentSigner } from '@/hooks/useParentSigner';
import {
  buildAssociationTemplate,
  buildAssocATag,
  buildPermissionTemplate,
  buildStateTemplate,
} from '@/lib/tepp/buildEvents';
import {
  KIND_PERMISSION_INTERACTION_NPUB_A,
  KIND_PERMISSION_INTERACTION_RELAY,
  KIND_PERMISSION_VIEW_NPUB_A,
  KIND_PERMISSION_VIEW_RELAY,
} from '@/lib/tepp/kinds';
import {
  auditMigrationStep,
  buildMigrationPlan,
  computeKidTemplates,
  markAcked,
  planFullyAcked,
  type TeppMigrationPlan,
  type TeppMigrationStep,
} from '@/lib/teppMigration';
import type { KuboFamily, KuboTrustLevel } from '@/hooks/useKuboFamily';
import { resolveKidSigner } from '@/lib/tepp-adapters/useKidSigner';
import type { PermissionRef } from '@/lib/tepp/types';

/**
 * One-shot, idempotent, resumable TEPP migration. TEPP is a core, non-optional
 * protection (KUBO-209), so the migration runs for every family with kids —
 * there is no enable flag to gate on. Triggers when:
 *   - `family` exists with at least one kid
 *   - `family.teppMigratedAt` is unset
 *   - parent is logged in
 *
 * Walks the persisted migration plan in order, publishing each step to the
 * relays. assoc-last so a partial migration leaves the construct fail-closed.
 * The plan persists under `family.teppMigrationPlan` so a reload mid-flight
 * resumes from the next un-acked step.
 *
 * **Q5 mitigation**: kids with no existing trust assignments AND a kind-3
 * follow list seed kind 8710 from those follows, so a fresh kid doesn't
 * see an empty feed when the flag flips on.
 */
export function useTeppMigration(): { running: boolean } {
  const { family } = useKuboFamily();
  const { users } = useCurrentUser();
  const { user: parent } = useParentSigner();
  const { nostr } = useNostr();
  // `running` latches for the lifetime of the attempt; `attemptedKey` records
  // the last family/parent combination we already kicked off, so the effect
  // does NOT re-fire on its own `setFamily` writes (runMigration persists the
  // plan after every step, which mutates `family` repeatedly).
  const runningRef = useRef(false);
  const attemptedKeyRef = useRef<string | null>(null);

  // Keep the latest values in refs so the effect body can read them without
  // listing `family`/`users`/`parent` as deps (their identities churn every
  // render and would retrigger the migration on each `setFamily` write).
  const familyRef = useRef(family);
  const usersRef = useRef(users);
  const parentRef = useRef(parent);
  const nostrRef = useRef(nostr);
  familyRef.current = family;
  usersRef.current = users;
  parentRef.current = parent;
  nostrRef.current = nostr;

  // Stable trigger key: which (parent, kids, logged-in signers) combination is
  // eligible right now. Only changes when the actual identities change — not on
  // plan-write churn. Including the sorted logged-in pubkeys means that when a
  // kid logs in (so the assoc step can finally sign), the key changes and the
  // migration retries the previously-skipped assoc step. No featureTepp gate:
  // TEPP is core and always on (KUBO-209), so any family with kids migrates.
  const loggedInKey = users.map((u) => u.pubkey).sort().join(',');
  const triggerKey =
    family && family.kids.length > 0 && !family.teppMigratedAt && parent
      ? `${parent.pubkey}:${family.kids.map((k) => k.pubkey).sort().join(',')}:${loggedInKey}`
      : null;

  useEffect(() => {
    if (!triggerKey) return;
    if (runningRef.current) return;
    if (attemptedKeyRef.current === triggerKey) return;
    attemptedKeyRef.current = triggerKey;
    runningRef.current = true;

    const fam = familyRef.current!;
    void runMigration({
      family: fam,
      parent: parentRef.current!,
      kidUsers: new Map(usersRef.current.map((u) => [u.pubkey, u])),
      nostr: nostrRef.current,
    }).finally(() => {
      runningRef.current = false;
    });
  }, [triggerKey]);

  return { running: runningRef.current };
}

interface RunArgs {
  family: KuboFamily;
  parent: { pubkey: string; signer: { signEvent: (t: unknown) => Promise<unknown>; nip44?: { encrypt: (pk: string, pt: string) => Promise<string> } } };
  kidUsers: Map<string, { pubkey: string; signer: { signEvent: (t: unknown) => Promise<unknown> } }>;
  nostr: {
    event: (e: NostrEvent, opts?: { signal?: AbortSignal }) => Promise<void>;
    query: (filters: unknown[], opts?: { signal?: AbortSignal }) => Promise<NostrEvent[]>;
  };
}

/** Dedup, capped list of member pubkeys (`p` tags) from a follow-pack event. */
function packMembersOf(event: NostrEvent): string[] {
  const out = new Set<string>();
  for (const [name, value] of event.tags) {
    if (name === 'p' && value) {
      out.add(value);
      if (out.size >= MAX_PACK_AUTHORS) break;
    }
  }
  return Array.from(out);
}

/**
 * Resolve the kid's seeded follow pack(s) to their member pubkeys, excluding
 * the kid and parent. Returns [] on any indexing gap / timeout — the migration
 * still publishes the rest, and a later boot (or a manual re-toggle) backfills.
 */
async function resolvePackMembers(opts: {
  family: KuboFamily;
  kidPubkey: string;
  parentPubkey: string;
  nostr: RunArgs['nostr'];
}): Promise<string[]> {
  const { family, kidPubkey, parentPubkey, nostr } = opts;
  const atags = family.feedSources?.[kidPubkey]?.packs ?? [];
  if (atags.length === 0) return [];
  try {
    const map = await fetchPacksByAtags(
      nostr as unknown as Parameters<typeof fetchPacksByAtags>[0],
      atags,
      AbortSignal.timeout(6000),
    );
    const members = new Set<string>();
    for (const { event } of map.values()) {
      for (const pk of packMembersOf(event)) {
        if (pk !== kidPubkey && pk !== parentPubkey) members.add(pk);
      }
    }
    return Array.from(members);
  } catch {
    return [];
  }
}

/** Tier under which a published permission event's id is recorded. Orders 5
 * (state) and 6 (assoc) are not permission events and return null. */
function tierForOrder(order: number): TeppPermissionTier | null {
  switch (order) {
    case 1:
      return 'view';
    case 2:
      return 'interact';
    case 3:
      return 'viewRelay';
    case 4:
      return 'interactRelay';
    default:
      return null;
  }
}

/**
 * Persist the migration plan by merging it onto the LATEST persisted family,
 * not a stale closure snapshot. `recordTeppPermissionId` writes
 * `teppLatestPermissionIds` between plan writes; spreading the run's captured
 * `family` here would clobber those ids straight back to empty (the
 * KUBO-134/135 hazard). Reading latest keeps both fields intact.
 */
async function persistPlan(plan: TeppMigrationPlan): Promise<void> {
  const latest = await readLatest();
  if (!latest) return;
  await setFamily({ ...latest, teppMigrationPlan: plan });
}

async function runMigration({ family, parent, kidUsers, nostr }: RunArgs): Promise<void> {
  let plan: TeppMigrationPlan = family.teppMigrationPlan ?? buildMigrationPlan(family);

  // Persist the freshly-built plan so any crash gives us something to resume from.
  if (!family.teppMigrationPlan) {
    await persistPlan(plan);
  }

  for (const kid of family.kids) {
    // Pre-fetch kind-3 follows for this kid (Q5 seed) — only when the kid
    // has no local trust assignments. Empty array if no kind-3.
    const trust = family.trustAssignments?.[kid.pubkey] ?? {};
    let kindThreeFollows: string[] = [];
    if (Object.keys(trust).length === 0) {
      try {
        const events = await nostr.query(
          [{ kinds: [3], authors: [kid.pubkey], limit: 1 }],
          { signal: AbortSignal.timeout(6000) },
        );
        // pick the most recent
        const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
        if (latest) {
          kindThreeFollows = latest.tags
            .filter((t) => t[0] === 'p' && /^[0-9a-f]{64}$/i.test(t[1] ?? ''))
            .map((t) => t[1]);
        }
      } catch {
        kindThreeFollows = [];
      }
    }

    // Resolve seeded follow-pack members so they get admitted at the `view`
    // tier out-of-the-box (KUBO-148). Independent of the Q5 kind-3 seed above.
    const packMemberViewPubkeys = await resolvePackMembers({
      family,
      kidPubkey: kid.pubkey,
      parentPubkey: parent.pubkey,
      nostr,
    });

    const templates = computeKidTemplates({
      family,
      kidPubkey: kid.pubkey,
      parentPubkey: parent.pubkey,
      kindThreeFollows,
      packMemberViewPubkeys,
    });

    // Auto-ack plan slots that have no template to publish for this kid
    // (e.g. step #3 = view-only relay-list when no relay-trust assignments
    // exist yet). Without this they stay 'pending' forever and the
    // migration never reports complete. We do NOT auto-ack the assoc step
    // (#6) — it's always required.
    const emittedOrders = new Set(templates.map((t) => t.order));
    const optionalOrders = [1, 2, 3, 4] as const;
    for (const order of optionalOrders) {
      if (emittedOrders.has(order)) continue;
      const stepId = `${kid.pubkey}:${order}`;
      const step = plan.steps.find((s) => s.id === stepId);
      if (!step || step.acked) continue;
      plan = markAcked(plan, stepId);
      await persistPlan(plan);
      auditMigrationStep({
        kidPubkey: kid.pubkey,
        parentPubkey: parent.pubkey,
        kind: 0,
        result: 'skipped',
        error: 'no entries for this tier',
      });
    }

    for (const tpl of templates) {
      const stepId = `${kid.pubkey}:${tpl.order}`;
      const step = plan.steps.find((s) => s.id === stepId);
      if (!step) continue;
      if (step.acked) continue;
      try {
        const event = await signMigrationTemplate({
          step,
          template: tpl.template,
          kidPubkey: kid.pubkey,
          parent,
          kidUsers,
          publicAssocATagFn: () => buildAssocATag(kid.pubkey),
          family,
        });
        if (!event) {
          // Skip — required signer (kid for assoc) not logged in.
          auditMigrationStep({
            kidPubkey: kid.pubkey,
            parentPubkey: parent.pubkey,
            kind: tpl.kind,
            result: 'skipped',
            error: 'kid not logged in for assoc',
          });
          continue;
        }
        await nostr.event(event, { signal: AbortSignal.timeout(8000) });

        // Record permission-event ids (orders 1–4) under teppLatestPermissionIds
        // so the order-5 state event can reference them — and so the manual
        // Trust-page path (useTrustAssignments) republishes the state with the
        // full set later. recordTeppPermissionId reads the latest persisted
        // family and merges, so it's safe across resume/interruption: if a prior
        // run already acked orders 1–4 and we resume straight into order 5, the
        // ids are still on disk and buildStatePermissionRefs picks them up.
        const tier = tierForOrder(tpl.order);
        if (tier) {
          await recordTeppPermissionId(kid.pubkey, tier, event.id);
        }

        plan = markAcked(plan, stepId);
        await persistPlan(plan);
        auditMigrationStep({
          kidPubkey: kid.pubkey,
          parentPubkey: parent.pubkey,
          kind: tpl.kind,
          eventId: event.id,
          result: 'published',
        });
      } catch (err) {
        auditMigrationStep({
          kidPubkey: kid.pubkey,
          parentPubkey: parent.pubkey,
          kind: tpl.kind,
          result: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
        // Halt this kid; resume on next boot. Other kids continue.
        break;
      }
    }
  }

  if (planFullyAcked(plan)) {
    // Merge onto latest (not the stale closure `family`) so the
    // teppLatestPermissionIds recorded during this run survive the completion
    // write. (KUBO-134/135 clobber hazard.)
    const latest = (await readLatest()) ?? family;
    await setFamily({
      ...latest,
      teppMigratedAt: Date.now(),
      teppMigrationPlan: undefined,
    });
  }
}

interface SignArgs {
  step: TeppMigrationStep;
  template: ReturnType<typeof buildPermissionTemplate>
    | ReturnType<typeof buildStateTemplate>
    | ReturnType<typeof buildAssociationTemplate>;
  kidPubkey: string;
  parent: RunArgs['parent'];
  kidUsers: RunArgs['kidUsers'];
  publicAssocATagFn: () => string;
  family: KuboFamily;
}

async function signMigrationTemplate(args: SignArgs): Promise<NostrEvent | null> {
  const { step, template, kidPubkey, parent, kidUsers, family } = args;

  if (step.order === 6) {
    // Association — kid must be logged in. KUBO-175: resolve through the shared
    // `resolveKidSigner` helper so this path uses the same typed reason taxonomy
    // (no-family / not-a-kid / kid-not-logged-in) as `useKidSigner`, rather than
    // an untyped `Map.get(...) ?? null`.
    const { user: kid, reason } = resolveKidSigner(
      [...kidUsers.values()],
      family,
      kidPubkey,
    );
    if (!kid) {
      // Same outcome as before (defer this step), but the reason is now explicit
      // and consistent with the rest of the kid-signer call sites.
      void reason;
      return null;
    }
    const signed = (await kid.signer.signEvent(template)) as NostrEvent;
    return signed;
  }

  if (step.order === 5) {
    // State event — needs encrypted private section AND public permission refs.
    //
    // KUBO-171: this order-5 state publish KEEPS its own `readLatest()` and does
    // NOT route through the serialized `useKuboTeppPublishState` chokepoint. It
    // is BOOT-ONLY (the migration runner walks a per-kid plan during boot, one
    // step at a time) and signs with the passed-in `parent.signer` rather than a
    // React hook, so there is no concurrent manual-flow to race here: by the time
    // the Trust/Relay pages can fire a manual state publish, migration has
    // already completed (teppMigratedAt set). It still reads refs at sign time
    // (below) so the invariant "state refs = latest recorded permission ids"
    // holds identically to the serialized path.
    if (!parent.signer.nip44) {
      throw new Error('NIP-44 v2 required for TEPP state events');
    }
    // The construct loads permission events by reading the state event's
    // `['permission', id, kind]` tags (publicPermissions) ∪ the decrypted
    // private section (useConstruct.ts). Orders 1–4 published earlier this run
    // recorded their event-ids under family.teppLatestPermissionIds via
    // recordTeppPermissionId; read the LATEST persisted family here (orders run
    // before order 5, and recordTeppPermissionId merges onto disk) and surface
    // every recorded id as a public ref. Without this the state event would
    // carry zero refs and clobber the construct to empty — exactly the bug
    // where seeded follow-pack members show "NOT ADMITTED" (KUBO-148).
    const latest = await readLatest();
    const publicPermissions = buildStatePermissionRefs(latest, kidPubkey);
    // Private section stays empty: the v0.1 construct assembles entirely from
    // the public refs, and mirroring the manual path (useTrustAssignments also
    // publishes empty private + public refs) keeps a single behaviour.
    const privateSection = JSON.stringify({ permissions: [] });
    const ciphertext = await parent.signer.nip44.encrypt(kidPubkey, privateSection);
    const stateTpl = buildStateTemplate({
      subject: kidPubkey,
      publicAssocATag: buildAssocATag(kidPubkey),
      publicPermissions,
      encryptedContent: ciphertext,
    });
    const signed = (await parent.signer.signEvent(stateTpl)) as NostrEvent;
    return signed;
  }

  // Permission events (orders 1–4): parent signs.
  // Avoid unused-template warnings by referencing template.kind.
  void template;
  void family;
  void planSampleKindForOrder(step.order);
  // The actual permission-event publish goes through a re-emit using the
  // generated template above — but we already have it.
  const signed = (await parent.signer.signEvent(args.template)) as NostrEvent;
  return signed;
}

/**
 * Build the public permission refs for a kid's state event from the recorded
 * latest permission-event ids. Mirrors `buildPublicPermissionRefs` in
 * useTrustAssignments so the migration's state event and the manual Trust-page
 * state event reference the same shape of refs. Returns [] when nothing has
 * been recorded yet (state event then carries no permission tags).
 */
function buildStatePermissionRefs(
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

function planSampleKindForOrder(order: number): number {
  switch (order) {
    case 1:
      return KIND_PERMISSION_VIEW_NPUB_A;
    case 2:
      return KIND_PERMISSION_INTERACTION_NPUB_A;
    case 3:
      return KIND_PERMISSION_VIEW_RELAY;
    case 4:
      return KIND_PERMISSION_INTERACTION_RELAY;
    default:
      return 0;
  }
}

// Avoid unused-symbol warnings for utility imports retained for clarity.
void (null as unknown as KuboTrustLevel);
