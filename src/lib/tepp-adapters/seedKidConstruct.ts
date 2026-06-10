import type { NostrEvent } from '@nostrify/nostrify';
import { NLogin, NUser } from '@nostrify/react/login';

import { fetchPacksByAtags } from '@/hooks/useFollowPacks';
import { MAX_PACK_AUTHORS } from '@/hooks/useKidFeed';
import {
  buildAssociationTemplate,
  buildAssocATag,
  buildPermissionTemplate,
  buildStateTemplate,
} from '@/lib/tepp/buildEvents';
import {
  KIND_PERMISSION_INTERACTION_NPUB_A,
  KIND_PERMISSION_VIEW_NPUB_A,
} from '@/lib/tepp/kinds';
import type { PermissionRef } from '@/lib/tepp/types';
import { assocExpirationAt } from '@/lib/tepp-adapters/assocExpiry';
import { appendTeppAuditEntry } from '@/lib/tepp-adapters/teppAuditLog';
import { clearVerdictCache } from '@/lib/tepp-adapters/verdictCache';

/** Minimal nostr surface this seed needs — a relay publish + a query. */
export interface SeedNostr {
  event: (e: NostrEvent, opts?: { signal?: AbortSignal }) => Promise<void>;
  query: (filters: unknown[], opts?: { signal?: AbortSignal }) => Promise<NostrEvent[]>;
}

/** Minimal parent signer surface — sign + NIP-44 v2 encrypt (nested form). */
export interface SeedParentSigner {
  pubkey: string;
  signer: {
    signEvent: (t: unknown) => Promise<NostrEvent>;
    nip44?: { encrypt: (pubkey: string, plaintext: string) => Promise<string> };
  };
}

/** Minimal kid signer surface — sign only (assoc + kind-3). */
export interface SeedKidSigner {
  pubkey: string;
  signEvent: (t: unknown) => Promise<NostrEvent>;
}

export interface SeedKidConstructArgs {
  nostr: SeedNostr;
  /** The fresh kid's nsec — used to sign the association (17700) + kind-3 follow list. */
  kidNsec: `nsec1${string}`;
  /** The fresh kid's pubkey (hex). */
  kidPubkey: string;
  /** The parent (guardian) signer — signs permission (8710/8712) + state (34700) events. */
  parent: SeedParentSigner;
  /** Enabled follow-pack a-tags whose members get seeded at `view`. */
  packAtags: string[];
  /**
   * Abort signal for relay round-trips. When provided it covers the WHOLE
   * seed (pack expansion + every publish). When omitted (production default)
   * the pack-expansion fetch and the sequential publishes each get their own
   * fresh 8s budget, so a slow pack fetch can never abort the publish sequence
   * mid-flight and leave a partial construct (KUBO-166).
   */
  signal?: AbortSignal;
  /**
   * Test seam: builds the kid signer from the nsec. Defaults to the same
   * `NLogin`/`NUser` construction the app uses for an nsec login. Tests inject
   * a stub to avoid the dual-`nostr-tools`-instance crypto mismatch that the
   * vitest module resolver introduces between `@nostrify/react` and
   * `@nostrify/nostrify`. Never set in production.
   */
  makeKidSigner?: (nsec: `nsec1${string}`) => SeedKidSigner;
}

export interface SeedKidConstructResult {
  /** Pack-member pubkeys granted `view` (lowercase hex), deduped + capped. */
  viewMembers: string[];
  /** The published permission/state/assoc event ids, for the caller to record. */
  permissionIds: { view?: string; interact: string };
  associationId: string;
  stateId: string;
}

/**
 * One-shot, atomic seeding of a freshly-created kid's TEPP construct, run
 * during onboarding **before** the kid lands on the feed (AddKidPage). It
 * publishes the complete initial construct in one correctly-ordered pass so
 * the feed's author allowlist already admits the default follow pack on first
 * paint — eliminating the "notes flash then vanish" race that arises when the
 * parent-side reconcile (`useEnsureParentTrust`) is the only seeding path and
 * only fires once the parent opens the Trust view.
 *
 * What it publishes (in order):
 *   1. kid association (17700)            — kid-signed, names the parent guardian
 *   2. interaction npub permission (8710) — parent-signed, lists the parent
 *   3. view npub permission (8712)        — parent-signed, lists the pack members
 *   4. kid state (34700)                  — parent-signed, references BOTH (2) and (3)
 *   5. kid kind-3 follow list             — kid-signed, follows the pack members
 *
 * The state event (4) is the single replaceable (d=kidPubkey) record that the
 * construct walks; carrying both permission refs at once is what prevents the
 * empty-refs clobber that the migration's order-5 publish used to cause.
 *
 * The kid's kind-3 (5) is signed directly with the kid's nsec and published
 * straight to relays — it deliberately bypasses `useNostrPublish`'s TEPP gate.
 * The gate exists to stop a kid following someone the parent has NOT admitted;
 * here we are admitting those exact members in the same pass, so gating the
 * seed would be a self-deny race. This mirrors the trusted-seed nature of
 * onboarding (the parent is driving it).
 *
 * Idempotency / safety: all four TEPP events use stable d-tags
 * (`tepp-assoc`, `<kid>`, `<kid>:interact:npub`, `<kid>:view:npub`), so a
 * re-run (e.g. a retried onboarding) replaces rather than duplicates. The
 * caller persists the returned ids into `family.teppLatestPermissionIds` and
 * marks the migration done so the migration runner doesn't re-seed.
 *
 * Throws on a hard failure (missing NIP-44, parent not a valid signer, relay
 * publish rejected). The caller (`AddKidPage`) catches and fails soft — kid
 * creation still completes and the parent-side reconcile remains the backstop.
 */
export async function seedKidConstruct(
  args: SeedKidConstructArgs,
): Promise<SeedKidConstructResult> {
  const { nostr, kidNsec, kidPubkey, parent, packAtags } = args;
  const kidLower = kidPubkey.toLowerCase();
  const parentLower = parent.pubkey.toLowerCase();

  const nip44 = parent.signer.nip44;
  if (!nip44) {
    throw new Error('NIP-44 v2 required for TEPP state events (parent signer lacks nip44)');
  }

  // Kid signer reconstructed from the nsec handed to us by onboarding. The
  // active useCurrentUser is still the parent at this point in AddKidPage, so
  // we cannot rely on a login-store lookup for the kid here. NLogin/NUser is
  // the same construction useNostrLogin uses for an nsec login, so the signer
  // behaves identically to a logged-in kid.
  const makeKidSigner = args.makeKidSigner ?? defaultKidSigner;
  const kidSigner = makeKidSigner(kidNsec);
  if (kidSigner.pubkey !== kidLower) {
    // Defensive: nsec must match the pubkey we were told to seed.
    throw new Error('seedKidConstruct: kid nsec does not match kid pubkey');
  }

  // Separate timeout budgets (KUBO-166). A caller-supplied signal opts into a
  // single shared budget for the whole seed; otherwise the pack-expansion fetch
  // and the publish sequence each get their own fresh 8s window so a slow pack
  // fetch can't abort the five sequential publishes mid-sequence and leave the
  // partial construct this function exists to prevent.
  const fetchSignal = args.signal ?? AbortSignal.timeout(8000);
  const publishSignal = args.signal ?? AbortSignal.timeout(8000);

  // ── 1. Expand enabled packs → member pubkeys (deduped, capped). ──────────
  // A relay hiccup here yields zero members; the kid still gets a valid
  // (parent-only) construct and the parent-side reconcile backfills later.
  const viewMembers = await expandPackMembers({
    nostr,
    packAtags,
    excludePubkeys: [kidLower, parentLower],
    signal: fetchSignal,
  });

  // ── 2. Association (17700) — kid signs, parent is the sole guardian. ─────
  const assocTpl = buildAssociationTemplate({
    subject: kidLower,
    guardians: [{ pubkey: parentLower }],
    expirationSeconds: assocExpirationAt(Math.floor(Date.now() / 1000)),
  });
  const assocEvent = (await kidSigner.signEvent(assocTpl)) as NostrEvent;
  await nostr.event(assocEvent, { signal: publishSignal });
  appendTeppAuditEntry({
    kind: assocEvent.kind,
    signerPubkey: kidLower,
    subjectPubkey: kidLower,
    eventId: assocEvent.id,
    note: 'TEPP association (onboarding seed)',
  });

  // ── 3. Interaction permission (8710) — parent signs, lists the parent. ───
  const interactTpl = buildPermissionTemplate({
    kind: KIND_PERMISSION_INTERACTION_NPUB_A,
    subject: kidLower,
    dIdentifier: `${kidLower}:interact:npub`,
    npubItems: [{ pubkey: parentLower }],
  });
  const interactEvent = (await parent.signer.signEvent(interactTpl)) as NostrEvent;
  await nostr.event(interactEvent, { signal: publishSignal });
  appendTeppAuditEntry({
    kind: interactEvent.kind,
    signerPubkey: parentLower,
    subjectPubkey: kidLower,
    eventId: interactEvent.id,
    note: 'TEPP permission 8710 (onboarding seed)',
  });

  // ── 4. View permission (8712) — parent signs, lists pack members. ────────
  // Skipped entirely when no members resolved (an empty 8712 would still be a
  // valid no-op, but emitting nothing keeps the construct lean).
  let viewEvent: NostrEvent | undefined;
  if (viewMembers.length > 0) {
    const viewTpl = buildPermissionTemplate({
      kind: KIND_PERMISSION_VIEW_NPUB_A,
      subject: kidLower,
      dIdentifier: `${kidLower}:view:npub`,
      npubItems: viewMembers.map((pubkey) => ({ pubkey })),
    });
    viewEvent = (await parent.signer.signEvent(viewTpl)) as NostrEvent;
    await nostr.event(viewEvent, { signal: publishSignal });
    appendTeppAuditEntry({
      kind: viewEvent.kind,
      signerPubkey: parentLower,
      subjectPubkey: kidLower,
      eventId: viewEvent.id,
      note: `TEPP permission 8712 (onboarding seed, ${viewMembers.length} members)`,
    });
  }

  // ── 5. State (34700) — parent signs, references BOTH permission events. ──
  // KUBO-171: this onboarding seed publishes its state DIRECTLY (it does not
  // route through the serialized `useKuboTeppPublishState` chokepoint). That is
  // intentional and safe: seeding runs once during onboarding, BEFORE the kid
  // exists in any concurrent trust/relay/reconcile flow, so there is nothing to
  // interleave with — the refs are built inline from the two events we just
  // published in this same function.
  const publicPermissions: PermissionRef[] = [
    { id: interactEvent.id, kind: KIND_PERMISSION_INTERACTION_NPUB_A },
  ];
  if (viewEvent) {
    publicPermissions.push({ id: viewEvent.id, kind: KIND_PERMISSION_VIEW_NPUB_A });
  }
  const ciphertext = await nip44.encrypt(
    kidLower,
    JSON.stringify({ permissions: [] }),
  );
  const stateTpl = buildStateTemplate({
    subject: kidLower,
    publicAssocATag: buildAssocATag(kidLower),
    publicPermissions,
    encryptedContent: ciphertext,
  });
  const stateEvent = (await parent.signer.signEvent(stateTpl)) as NostrEvent;
  await nostr.event(stateEvent, { signal: publishSignal });
  appendTeppAuditEntry({
    kind: stateEvent.kind,
    signerPubkey: parentLower,
    subjectPubkey: kidLower,
    eventId: stateEvent.id,
    note: `TEPP state (onboarding seed, ${publicPermissions.length} public refs)`,
  });

  // ── 6. Kid kind-3 follow list — kid signs, follows the pack members. ─────
  // Bypasses the TEPP gate by design (see the function doc). No-op when empty.
  if (viewMembers.length > 0) {
    const followTpl = {
      kind: 3,
      content: '',
      tags: viewMembers.map((pubkey) => ['p', pubkey]),
      created_at: Math.floor(Date.now() / 1000),
    };
    const followEvent = (await kidSigner.signEvent(followTpl)) as NostrEvent;
    await nostr.event(followEvent, { signal: publishSignal });
    appendTeppAuditEntry({
      kind: followEvent.kind,
      signerPubkey: kidLower,
      subjectPubkey: kidLower,
      eventId: followEvent.id,
      note: `TEPP kid kind-3 follow list (onboarding seed, ${viewMembers.length} members)`,
    });
  }

  // Flush any stale per-event verdicts so the first feed evaluation sees the
  // construct we just published.
  clearVerdictCache();

  return {
    viewMembers,
    permissionIds: { view: viewEvent?.id, interact: interactEvent.id },
    associationId: assocEvent.id,
    stateId: stateEvent.id,
  };
}

/**
 * Default kid-signer factory: the same `NLogin`/`NUser` construction the app
 * uses for an nsec login (see `useCurrentUser`), so the seed signs identically
 * to a logged-in kid. Overridable via `args.makeKidSigner` for hermetic tests.
 */
function defaultKidSigner(nsec: `nsec1${string}`): SeedKidSigner {
  const user = NUser.fromNsecLogin(NLogin.fromNsec(nsec));
  return {
    pubkey: user.pubkey,
    signEvent: (t) => user.signer.signEvent(t as Parameters<typeof user.signer.signEvent>[0]),
  };
}

/**
 * Expand follow-pack a-tags into a deduped, capped list of member pubkeys
 * (lowercase hex), excluding the kid + parent. Mirrors the pack-member
 * expansion in `useKidFeed`/`useEnsureParentTrust` so the seed grants `view`
 * to exactly the authors the feed will surface — no more, no less.
 */
export async function expandPackMembers(opts: {
  nostr: SeedNostr;
  packAtags: string[];
  excludePubkeys: string[];
  signal: AbortSignal;
}): Promise<string[]> {
  const { nostr, packAtags, excludePubkeys, signal } = opts;
  if (packAtags.length === 0) return [];
  const exclude = new Set(excludePubkeys.map((p) => p.toLowerCase()));
  try {
    const packMap = await fetchPacksByAtags(nostr, packAtags, signal);
    const members = new Set<string>();
    outer: for (const pack of packMap.values()) {
      for (const [name, value] of pack.event.tags) {
        if (name !== 'p' || !value) continue;
        const lower = value.toLowerCase();
        if (exclude.has(lower)) continue;
        members.add(lower);
        if (members.size >= MAX_PACK_AUTHORS) break outer;
      }
    }
    return [...members];
  } catch {
    return [];
  }
}
