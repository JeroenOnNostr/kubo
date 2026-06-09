# TEPP Integration — Overview

**TEPP** (Trust Extension Permission Protocol, v0.1.1) wires the existing Kubo "trust" UI under `/parent/trust/people` and `/parent/trust/places` to a real Nostr-event-based permission system. Parent-as-guardian publishes association (kind 17700), state (34700), permission (8710–8717), blacklist (8720), and global-restriction (8721) events on the kid-as-subject's behalf. Inbound feed events are filtered through TEPP's `evaluateEvent`. Outbound kid-authored events are gated at the signing boundary.

The integration is **feature-flagged** (`featureTepp` in [kubo.json](../kubo.json)), defaults to **off**, and does not change Kubo's existing localStorage trust behaviour until the flag is flipped.

## Where the code lives

| Path | Owner | Role |
|---|---|---|
| [src/lib/tepp/](../src/lib/tepp/) | **Vendored from upstream** (do not edit) | 11 pure-logic TEPP files: types, parsers, evaluator, references, restrictions, buildEvents. |
| [src/lib/tepp-adapters/](../src/lib/tepp-adapters/) | Kubo-owned | Glue: signer adapter, pool wrapper, kid-signer, construct orchestrator, TanStack-Query construct hook, fingerprint, verdict cache, audit log, **reference-closure prefetch** (`referenceClosure.ts`). |
| `src/hooks/useKuboTepp*.ts` | Kubo-owned | React hook surface for app code: `useKuboTeppConstruct`, `useKuboTeppEvaluateEvent`, `useKuboTeppPublishPermission`, `useKuboTeppPublishAssociation`, `useKuboTeppPublishState`, `useKuboTeppGate`. |
| `src/components/trust/` | Kubo-owned | Existing trust UI; mutations re-routed to TEPP publish hooks (Phase 4b) when flag is on. |
| `src/lib/teppMigration.ts` | Kubo-owned | One-shot migration of legacy localStorage assignments to TEPP events. |

## How to update the vendored code

See [src/lib/tepp/SOURCE.md](../src/lib/tepp/SOURCE.md) for the upstream-pull workflow. Future TEPP releases that touch the 11 pure-logic files merge in cleanly via `git mv` from a staging subtree-pull. Releases that touch `construct.ts` or `useConstruct.ts` upstream require a manual port into the Kubo adapter — this is the protocol/integration boundary by design.

## Identity model

- **Kid = TEPP subject.** Parent = guardian.
- The Kubo family record at [src/hooks/useKuboFamily.ts](../src/hooks/useKuboFamily.ts) stores `{pubkey, displayName}` per kid — **no nsec**. Each kid is a real Nostrify login living in `useCurrentUser().users`.
- **Association events (kind 17700)** are signed by the kid via [`useKidSigner(kidPubkey)`](../src/lib/tepp-adapters/useKidSigner.ts), which mirrors `useParentSigner`'s lookup pattern. Requires the kid to be logged in via the kid switcher.
- **State (34700), permission (8710–8717), blacklist (8720), global (8721) events** are signed by the parent via `useParentSigner`.
- **Kid-authored regular events** (kind 1, 6, 7, zaps, …) go through `useNostrPublish`, which gains a TEPP gate (Phase 5) when the active user is a kid and `featureTepp` is on.

## The signer-adapter arg-order gotcha

TEPP's [auth/signer.ts](../src/lib/tepp-staging/tepp-webapp/src/auth/signer.ts) (in the upstream repo) declares flat methods on the `Signer` interface:

```ts
nip44Encrypt(plaintext: string, recipientPubkey: string): Promise<string>
nip44Decrypt(ciphertext: string, senderPubkey: string): Promise<string>
```

Kubo's `NUser` exposes the **nested** form with **swapped argument order**:

```ts
user.signer.nip44.encrypt(recipientPubkey, plaintext): Promise<string>
user.signer.nip44.decrypt(senderPubkey, ciphertext): Promise<string>
```

The arg-order swap and the flat-vs-nested shape mismatch are reconciled in exactly **one place** — [src/lib/tepp-adapters/signerAdapter.ts](../src/lib/tepp-adapters/signerAdapter.ts) (added in Phase 1). Every TEPP code path that needs a signer gets one through this adapter; every Kubo code path uses Kubo's native shape. Do not manually call TEPP's flat methods from Kubo code, and do not call Kubo's nested methods from inside vendored TEPP code.

## Feature flag

`featureTepp` lives under `feedSettings` in [kubo.json](../kubo.json), validated by `DittoConfigSchema` in [vite.config.ts](../vite.config.ts), merged into runtime config via `AppProvider`. When false (default):

- No TEPP events are emitted.
- No construct is fetched.
- The existing localStorage-only trust UI behaves exactly as it does today.

To experiment locally, edit `kubo.json` and set `feedSettings.featureTepp: true`, then `npm run dev`. Migration runs automatically on first boot with the flag on (Phase 6).

## Direction terminology

The TEPP evaluator uses `Direction = 'outgoing' | 'incoming'`. All Kubo hook code, verdict shapes, and tests use these exact strings. Any reference to `'inbound'` or `'outbound'` is a bug — the spec and the evaluator both use `'outgoing'`/`'incoming'`.

## Reference resolution (the evaluator needs a populated `eventCache`)

The vendored `evaluateEvent` is a **pure** function: it reads referenced events
(a reply's parent, a quoted note, a repost target) from a caller-supplied
`opts.eventCache` and returns a `pending` verdict for any reference it can't
find. Its doc comment names a `prefetchReferenceClosure` the caller "should"
invoke — that function was originally never implemented, so every reply / quote
/ repost evaluated to `pending` and was dropped from the kid feed (and kid
replies were blocked at publish). This was the headline integration bug.

The fix lives in two pieces:

- [src/lib/tepp-adapters/referenceClosure.ts](../src/lib/tepp-adapters/referenceClosure.ts) —
  `prefetchReferenceClosure(seeds, query, opts)` walks event references
  breadth-first up to `maxDepth` hops (default 4, matching the evaluator's
  recursion limit), batching each hop into one `{ ids: [...] }` query, and
  returns the `eventCache` map. Pure I/O; reusable from any query function.
- [src/hooks/useTeppReferenceCache.ts](../src/hooks/useTeppReferenceCache.ts) —
  a TanStack-Query hook keyed on `(constructFingerprint, sorted seed ids)` that
  drives the prefetch for the batch of events currently on screen.

Read path ([useKuboTeppFeedFilter.ts](../src/hooks/useKuboTeppFeedFilter.ts),
[useKuboTeppEvaluateEvent.ts](../src/hooks/useKuboTeppEvaluateEvent.ts)) and
write path ([useKuboTeppGate.ts](../src/hooks/useKuboTeppGate.ts)) both thread
this cache into `evaluateEvent`.

**Fail-open policy.** A post is hidden / an action blocked **only on a concrete
`deny`**. While the closure is still loading, or a reference genuinely can't be
fetched (relay gap), the verdict is `pending` and we **show / allow** — a kid is
never punished for a reference we couldn't load, and allowed posts never blink
out mid-fetch. Settled `permit-*` and `pending` verdicts are visible; only
`deny` restricts. `pending` verdicts are intentionally **not** memoized in the
verdict cache so a later closure fetch re-evaluates cleanly.

## Mode-A only in v1

The UI exposes only mode-A permission kinds (8710, 8712, 8714, 8715, 8716, 8717). Mode-B (8711, 8713) is unexposed. The spec already requires `extend` pairs to use mode-A only — `buildEvents.ts` enforces this defensively.

## Request-to-Interact

When a kid taps `RequestInteractButton` on a view-only or unassigned creator, Kubo publishes a **NIP-59 gift wrap (kind 1059)** carrying a structured rumor:

```json
{
  "type": "kubo:request-to-interact",
  "target": "<hex pubkey>",
  "requested-by": "<kid hex pubkey>",
  "requested-at": <unix-seconds>
}
```

This is a Kubo-application-layer event, **not a TEPP-protocol kind** — the TEPP spec leaves request mechanics implementation-level (§"Refresh"). Gift-wrap leaks no metadata to relays beyond "kid talks to parent." Cancel = NIP-09 deletion of the envelope. Approval = parent calls `useKuboTeppPublishPermission` to add the target to the kid's kind-8710 interact list.

## Rollback

Flip `featureTepp: false` and ship. Trust UI immediately falls back to localStorage-only. Already-published TEPP events stay on the relay (harmless without readers). Migration record stays in the family record so a re-enable resumes from where it left off.

For a hard rollback, `git revert` the integration commits. The vendored `src/lib/tepp/` directory remains; that's fine — unused without the adapter layer.
