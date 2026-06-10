# TEPP — Vendored pure-logic carve-out

This directory holds **only the 11 pure-logic files** from TEPP's `tepp-webapp/src/tepp/`. Each file imports only `nostr-tools` and its siblings here. The two orchestrator files (`construct.ts`, `useConstruct.ts`) are **deliberately omitted** — their Kubo-owned reimplementations live under [src/lib/tepp-adapters/](../tepp-adapters/) so they bind to Kubo's Nostrify pool and `useParentSigner` / `useKidSigner`.

## Upstream

- **Repo (Nostr-native, GRASP):** `nostr://npub10av9rgtyv2rvgtrfnek3v72j00cglw7kfa07wfspnuwm2dgnzarqs89p4c/relay.ngit.dev/tepp`
- **Web mirror:** https://gitworkshop.dev/npub10av9rgtyv2rvgtrfnek3v72j00cglw7kfa07wfspnuwm2dgnzarqs89p4c/relay.ngit.dev/tepp
- **Vendored at upstream commit:** `c770e74` — *Feed verdict strip: rich layer-aware explanations + working refs panel*
- **Spec version at this snapshot:** v0.1.1

## What lives here (do not edit)

| File | Purpose |
|---|---|
| `types.ts` | Type definitions for parsed events, references, restrictions. |
| `kinds.ts` | Numeric constants for kinds 17700, 34700, 8710–8717, 8720, 8721. |
| `parse.ts`, `parseState.ts`, `parsePermission.ts`, `parseBlacklist.ts`, `parseGlobal.ts` | Parsers for each event kind into `Parsed*` types. |
| `evaluate.ts` | `evaluateEvent(event, construct, direction, opts)` — `Direction = 'outgoing' \| 'incoming'`. |
| `references.ts` | Extracts referenceable surfaces (p/q/e/r tags, NIP-21 tokens, bare bech32, hex). |
| `restrictions.ts` | Four-regime restriction evaluator. |
| `buildEvents.ts` | `buildAssociationTemplate`, `buildStateTemplate`, `buildPermissionTemplate`, `buildBlacklistTemplate`, `buildGlobalRestrictionTemplate`. |

## What is intentionally NOT here

- `construct.ts` (`assembleConstruct` orchestrator) — reimplemented in [../tepp-adapters/construct.ts](../tepp-adapters/construct.ts).
- `useConstruct.ts` (React hook) — reimplemented as a TanStack-Query hook in [../tepp-adapters/useConstruct.ts](../tepp-adapters/useConstruct.ts).

## Local deviations

These vendored files carry small, upstreamable Kubo patches. Each patch site is
marked with a `// KUBO-xxx deviation:` comment. When updating from upstream,
re-apply (or upstream) each of these.

| File | Task | Change |
|---|---|---|
| `parse.ts` | KUBO-157 | Guard `expiration` against non-finite / out-of-range values before building the `expiresAtIso` Date (a forged 17700 with `expiration` ≈ `1e20` previously threw a `RangeError` inside `pickCurrentAssociation`, crashing the construct query). A present-but-invalid expiration is now treated as `expired: true` (fail-closed) instead of never-expires. `pickCurrentAssociation` wraps each candidate parse in try/catch so a throwing candidate is skipped, not fatal. |
| `evaluate.ts` | KUBO-175 | In `isHexKnownAsPubkey`, replace the magic literal `8713` with the named constant `KIND_PERMISSION_VIEW_NPUB_B` and correct the comment that wrongly claimed that kind was "intentionally omitted" (it was actually being matched). No behaviour change. |
| `evaluate.ts` | KUBO-161 | Relay-hint references must not hard-deny. New `constructHasRelayRules()` helper: when the construct carries **zero** relay permission entries AND an empty relay blacklist, relay references are unrestricted and filtered out before evaluation (the seeded Kubo construct emits no relay lists, but nearly every real note carries relay hints — without this the whole feed blanks). When relay lists DO exist, semantics are unchanged, but in `finalize` a relay-hint **allow-list miss** becomes a redactable deny on `incoming` (hint is metadata; mask it, keep the note) while staying a hard deny on `outgoing`. A relay **blacklist** deny stays hard in both directions. Arguably an upstream spec bug. |
| `evaluate.ts` | KUBO-162 | In `finalize`, denies are classified redactable **only when `direction === 'incoming'`**; on `outgoing` every deny is hard. You cannot redact an event you publish — previously a kid draft quoting blocked cached content (`["q", <blockedId>]`) downgraded to `permit-with-redactions` and the write-gate (blocks only on `'deny'`) let it through. Also closes the deep-nesting outgoing smuggling case. Incoming behaviour (nested-event redaction) unchanged. |
| `references.ts` | KUBO-165 | (a) `i` flag added to `BECH32_*`, `HEX_BARE`, and the `nostr:` token regex; bech32 tokens lower-cased before `nip19.decode`. bech32 is case-insensitive (BIP-173) — previously `NOSTR:NPUB1…`, all-caps bare bech32, and all-caps 64-hex extracted nothing (an unextracted ref can't be denied → fail-open). (b) NIP-10 marked `e`-tags: when index 4 is a 64-hex pubkey (`["e", id, relay, marker, pubkey]`) also push a `pubkey` reference, so a reply that omits the p-tag is still gated on the parent author without needing the parent event fetched. |
| `evaluate.ts` | KUBO-165 | In `finalize`, a bare-hex (`hex-ambiguous`) `unadmitted` deny is redactable on `incoming` (txids / commit hashes / random 64-hex in normal notes must not hide the whole note) and a hard deny on `outgoing` (per KUBO-162). |
| `restrictions.ts` | KUBO-175 | `parseKindList` now requires base-10 integer tokens (`/^\d+$/`) instead of `Number()`+`isFinite`, rejecting floats / negatives / hex / exponent forms that are not valid Nostr kinds. Plus a doc comment documenting the half-open `[start, end)` time-window boundary in `restrictionMatches`. |

## How to update from upstream

The subtree was added with `--prefix=src/lib/tepp-staging`, then the 11 files were `git mv`'d into here and the staging dir was deleted. That means a vanilla `git subtree pull --prefix=src/lib/tepp …` will NOT work — the prefix tree is a strict subset of upstream.

**Update workflow** (when TEPP cuts a new release):

1. From `kubo/`, re-stage the upstream:
   ```
   git subtree add --prefix=src/lib/tepp-staging \
     "<path-to-tepp-clone>" main --squash
   ```
   (Or use `git subtree pull --prefix=src/lib/tepp-staging …` if a previous staging-add still exists.)
2. Diff the upstream `tepp-webapp/src/tepp/*.ts` against our `src/lib/tepp/*.ts`. For each pure-logic file in the 11-file list above:
   - If unchanged: no-op.
   - If changed: `git mv -f src/lib/tepp-staging/tepp-webapp/src/tepp/<file>.ts src/lib/tepp/<file>.ts`.
3. **If `construct.ts` or `useConstruct.ts` changed upstream**, manually port the change into [../tepp-adapters/construct.ts](../tepp-adapters/construct.ts) / [../tepp-adapters/useConstruct.ts](../tepp-adapters/useConstruct.ts). This is intentional — those files are the protocol-to-Kubo boundary.
4. `git rm -rf src/lib/tepp-staging`.
5. Update the "Vendored at upstream commit" line above with the new SHA.
6. Run `npm test` and a smoke build before committing.

See [kubo/docs/tepp-integration.md](../../../docs/tepp-integration.md) for the full integration overview.
