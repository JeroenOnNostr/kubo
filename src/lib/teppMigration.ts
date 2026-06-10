import type { NUser } from '@nostrify/react/login';
import type { NostrEvent } from '@nostrify/nostrify';

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
import { appendTeppAuditEntry } from '@/lib/tepp-adapters/teppAuditLog';
import { assocExpirationAt } from '@/lib/tepp-adapters/assocExpiry';
import type { KuboFamily, KuboTrustLevel } from '@/hooks/useKuboFamily';

/**
 * Per-kid migration plan, persisted under `family.teppMigrationPlan`. The
 * publish loop walks each step in order and marks it `acked` on success.
 * On crash/reload we skip already-acked steps. assoc-last so a partial
 * migration leaves the construct fail-closed (no association → no construct
 * → no events → fall back to localStorage UI).
 */
export interface TeppMigrationStep {
  /** Stable id for resume tracking — `${kidPubkey}:${kind}:${dIdentifier}`. */
  id: string;
  kidPubkey: string;
  /**
   * Order of publish for a kid's event set:
   *  - 1 view-only npub list (kind 8712)
   *  - 2 interaction npub list (kind 8710)
   *  - 3 view-only relay list (kind 8715)
   *  - 4 interaction relay list (kind 8714)
   *  - 5 state event (kind 34700)
   *  - 6 association event (kind 17700)  ← assoc-last
   */
  order: number;
  acked: boolean;
}

export interface TeppMigrationPlan {
  startedAt: number;
  steps: TeppMigrationStep[];
}

export interface MigrationContext {
  family: KuboFamily;
  parent: NUser;
  /** kidPubkey → NUser (only kids who are logged in on this device). */
  kidUsers: Map<string, NUser>;
  /** Optional kind-3 follow list per kid. Empty when not provided. */
  kidFollowsByPubkey: Map<string, string[]>;
  publish: (event: NostrEvent) => Promise<void>;
}

export interface MigrationProgress {
  step: TeppMigrationStep;
  result: 'published' | 'skipped' | 'failed';
  error?: string;
}

/**
 * Compute the full set of TEPP events to publish for a kid given the local
 * trust assignments. Returns event templates ready to sign.
 *
 * **Q5 mitigation**: when a kid has zero npub-tier assignments AND a kind-3
 * follow list is available, those follows seed the `interact` (kind 8710)
 * list. Avoids an empty feed on first boot. Only applies once.
 *
 * **Default-pack seed (KUBO-148)**: members of the kid's seeded follow
 * pack(s) — held in `feedSources[kid].packs` and resolved by the caller —
 * are folded into the `view` (kind 8712) list so the TEPP construct admits
 * them out-of-the-box. Without this, a fresh install's default pack lands in
 * the feed-source list but never gets a permission event, so every pack
 * profile reads "NOT ADMITTED" and the kid feed is empty. The manual
 * Packs-page toggle (`useAddFeedPack`) grants the same `view` tier, so this
 * keeps onboarding and the toggle behaving identically.
 */
export function computeKidTemplates(opts: {
  family: KuboFamily;
  kidPubkey: string;
  parentPubkey: string;
  kindThreeFollows?: string[];
  /**
   * Pubkeys resolved from the kid's seeded follow pack(s). Merged into the
   * `view` tier (deduped against explicit assignments; kid + parent excluded
   * by the caller). Empty when no packs are seeded or resolution failed.
   */
  packMemberViewPubkeys?: string[];
}): { kind: number; template: ReturnType<typeof buildPermissionTemplate> | ReturnType<typeof buildStateTemplate> | ReturnType<typeof buildAssociationTemplate>; order: number }[] {
  const { family, kidPubkey, parentPubkey, kindThreeFollows = [], packMemberViewPubkeys = [] } = opts;
  const trust = family.trustAssignments?.[kidPubkey] ?? {};
  const relayTrust = family.relayTrustAssignments?.[kidPubkey] ?? {};

  const groupedNpub = groupByTier(trust);
  const groupedRelay = groupByTier(relayTrust);

  // Q5 seed: if no npub assignments at all, fall back to kind-3 follows as interact-tier.
  const hasAnyNpubAssignment =
    Object.keys(trust).length > 0;
  const seededInteractNpubs =
    !hasAnyNpubAssignment && kindThreeFollows.length > 0
      ? kindThreeFollows
      : undefined;

  // Fold seeded pack members into the view tier, deduped against any tier the
  // pubkey already holds (an explicit interact/extend assignment is stronger
  // than view, so never downgrade it by also listing it under view).
  const explicitlyAssigned = new Set(Object.keys(trust));
  const viewPubkeys = Array.from(
    new Set([
      ...groupedNpub.view,
      ...packMemberViewPubkeys.filter((pk) => !explicitlyAssigned.has(pk)),
    ]),
  );

  const out: ReturnType<typeof computeKidTemplates> = [];

  // 1. view-only npub list (8712)
  if (viewPubkeys.length > 0) {
    out.push({
      kind: KIND_PERMISSION_VIEW_NPUB_A,
      template: buildPermissionTemplate({
        kind: KIND_PERMISSION_VIEW_NPUB_A,
        subject: kidPubkey,
        dIdentifier: `${kidPubkey}:view:npub`,
        npubItems: viewPubkeys.map((pubkey) => ({ pubkey })),
      }),
      order: 1,
    });
  }

  // 2. interaction npub list (8710) — including 'extend' tier; the extend tag
  //    is added defensively below.
  const interactPubkeys = seededInteractNpubs
    ? seededInteractNpubs
    : [...groupedNpub.interact, ...groupedNpub.extend];
  if (interactPubkeys.length > 0) {
    out.push({
      kind: KIND_PERMISSION_INTERACTION_NPUB_A,
      template: buildPermissionTemplate({
        kind: KIND_PERMISSION_INTERACTION_NPUB_A,
        subject: kidPubkey,
        dIdentifier: `${kidPubkey}:interact:npub`,
        npubItems: interactPubkeys.map((pubkey) => ({ pubkey })),
        // Extend pairs only if the local family has any 'extend' tier
        // entries — and only mode-A (8710 → 8710 as-is). Mode-B is forbidden.
        extendPairs:
          groupedNpub.extend.length > 0 && !seededInteractNpubs
            ? [{ kind: KIND_PERMISSION_INTERACTION_NPUB_A, mutation: 'as-is' }]
            : undefined,
      }),
      order: 2,
    });
  }

  // 3. view-only relay list (8715)
  if (groupedRelay.view.length > 0) {
    out.push({
      kind: KIND_PERMISSION_VIEW_RELAY,
      template: buildPermissionTemplate({
        kind: KIND_PERMISSION_VIEW_RELAY,
        subject: kidPubkey,
        dIdentifier: `${kidPubkey}:view:relay`,
        relayItems: groupedRelay.view,
      }),
      order: 3,
    });
  }

  // 4. interaction relay list (8714)
  const interactRelays = [...groupedRelay.interact, ...groupedRelay.extend];
  if (interactRelays.length > 0) {
    out.push({
      kind: KIND_PERMISSION_INTERACTION_RELAY,
      template: buildPermissionTemplate({
        kind: KIND_PERMISSION_INTERACTION_RELAY,
        subject: kidPubkey,
        dIdentifier: `${kidPubkey}:interact:relay`,
        relayItems: interactRelays,
      }),
      order: 4,
    });
  }

  // 5. state event (34700) — content is the encrypted private section. The
  //    actual encryption happens in the publishing step (the parent signer
  //    needs to be available); here we emit a placeholder template that the
  //    runner replaces.
  out.push({
    kind: 34700,
    template: buildStateTemplate({
      subject: kidPubkey,
      publicAssocATag: buildAssocATag(kidPubkey),
      encryptedContent: '__PLACEHOLDER__',
    }),
    order: 5,
  });

  // 6. association event (17700)
  out.push({
    kind: 17700,
    template: buildAssociationTemplate({
      subject: kidPubkey,
      guardians: [{ pubkey: parentPubkey }],
      expirationSeconds: assocExpirationAt(Math.floor(Date.now() / 1000)),
    }),
    order: 6,
  });

  return out;
}

function groupByTier(entries: Record<string, KuboTrustLevel>): {
  view: string[];
  interact: string[];
  extend: string[];
} {
  const out = { view: [] as string[], interact: [] as string[], extend: [] as string[] };
  for (const [target, tier] of Object.entries(entries)) {
    out[tier].push(target);
  }
  return out;
}

/**
 * Build a fresh migration plan from a family record. Returns one step per
 * (kid, kind) tuple. Caller persists this to localStorage and walks it.
 */
export function buildMigrationPlan(family: KuboFamily): TeppMigrationPlan {
  const steps: TeppMigrationStep[] = [];
  for (const kid of family.kids) {
    for (const order of [1, 2, 3, 4, 5, 6] as const) {
      steps.push({
        id: `${kid.pubkey}:${order}`,
        kidPubkey: kid.pubkey,
        order,
        acked: false,
      });
    }
  }
  return { startedAt: Date.now(), steps };
}

/**
 * Mark a step as acked by id. Returns a new plan (immutable).
 */
export function markAcked(plan: TeppMigrationPlan, id: string): TeppMigrationPlan {
  return {
    ...plan,
    steps: plan.steps.map((s) => (s.id === id ? { ...s, acked: true } : s)),
  };
}

export function planFullyAcked(plan: TeppMigrationPlan): boolean {
  return plan.steps.every((s) => s.acked);
}

/**
 * Diagnostic helper: surface a one-line summary of the plan for logging.
 */
export function summarizeMigrationPlan(plan: TeppMigrationPlan): string {
  const total = plan.steps.length;
  const done = plan.steps.filter((s) => s.acked).length;
  return `tepp-migration: ${done}/${total} steps acked (started ${new Date(plan.startedAt).toISOString()})`;
}

/**
 * Audit a single migration step result. The actual publish loop lives in
 * `useTeppMigration` (Phase 6 hook), which wires this to React lifecycle.
 */
export function auditMigrationStep(args: {
  kidPubkey: string;
  parentPubkey: string;
  kind: number;
  eventId?: string;
  result: 'published' | 'skipped' | 'failed';
  error?: string;
}): void {
  appendTeppAuditEntry({
    kind: args.kind,
    signerPubkey: args.kind === 17700 ? args.kidPubkey : args.parentPubkey,
    subjectPubkey: args.kidPubkey,
    eventId: args.eventId,
    note: `migration ${args.result}${args.error ? `: ${args.error}` : ''}`,
  });
}
