# TEPP Hardening Plan — KUBO-152 … KUBO-175

> Output of the 2026-06-10 five-track deep review of the TEPP integration (vendored core,
> adapter layer, enforcement hooks/UI, migration/lifecycle, adversarial security).
> Every finding below was verified against actual code (several by executing scratch tests
> through the real evaluator) before being included. File:line references are as of trunk
> `brand/main` on 2026-06-10.
>
> **How to use this document:** each KUBO task is self-contained and written to be handed
> to an implementation agent on its own. Work the phases in order; within a phase, tasks
> are independent unless a ⚠ sequencing note says otherwise. Every task ends with
> "Done when" acceptance criteria — do not mark a task complete until all of them hold
> and `npx tsc -b && npx eslint . && npx vitest run` are clean.

---

## Read this first (context for implementation agents)

- **TEPP** is a Nostr parental-control protocol. Per kid, a **construct** is assembled from:
  kind **17700** (kid-signed association naming the guardian, NIP-40 expiration),
  kind **34700** (parent-signed replaceable state event whose refs select the current
  permission events), kinds **8710–8717** (permission lists: view/interact/extend tiers for
  npubs/relays/events), kind **8720** (blacklist), kind **8721** (global restrictions).
- **Vendored core** `src/lib/tepp/` (11 pure-logic files, upstream commit `c770e74`, spec
  v0.1.1). Per `src/lib/tepp/SOURCE.md` these are normally do-not-edit; tasks in this plan
  that patch them (KUBO-157, 161, 162, 165) MUST also: (a) add a `// KUBO-xxx deviation:`
  comment at the patch site, (b) append the deviation to a new "Local deviations" section
  in `SOURCE.md`, (c) leave the change small and upstreamable (upstream repo:
  `nostr://npub10av9rgt…/relay.ngit.dev/tepp` via ngit — see memory `gitworkshop-ngit.md`).
- **Adapters** `src/lib/tepp-adapters/` (construct assembly, signer seam, caches, expiry).
- **Enforcement hooks** `src/hooks/useKuboTepp*.ts` + UI call sites.
- **Migration/lifecycle**: `src/lib/teppMigration.ts`, `src/hooks/useTeppMigration.ts`,
  `useTeppDefaultOnMigration.ts`, `useEnsureKidAssociation` (in `useKuboTeppPublish.ts`),
  `useEnsureParentTrust.ts`.
- Invariants that already hold and must not be broken: signer arg-order seam is only in
  `signerAdapter.ts`; kid-signed 17700s go through `useKidSigner`; verdict-cache
  fingerprinting includes all construct source ids; migration publishes state (order 5)
  with the full recorded ref set; `useEnsureKidAssociation`'s per-kid session guard.
- **Severity legend**: fixing fail-open = a kid could see/publish what the parent blocked.
  Fixing fail-closed/over-block = the product breaks (empty feed, bricked publishes).
  Both matter; fail-open fixes come first.

### Threat-model decision needed (Jeroen, before Phase A lands)

All enforcement is client-side on a device the kid uses. A kid with devtools can
ultimately defeat any client-side control (the parent key itself is on the shared device —
see KUBO-153 notes). The plan below assumes the realistic Kubo threat model:
**young kids who tap around, plus untrusted relays/content authors** — not a teenage
attacker with devtools. Tasks KUBO-152/153/156/157 still close the *accidental* and
*remote-attacker* versions of those holes and are worth doing regardless. If the threat
model should include a devtools-capable kid, additionally schedule: parent signer via
NIP-46 bunker off-device, and native-only secure storage (no localStorage fallback in
`src/lib/secureStorage.ts:17,38`).

---

## Phase A — Fail-closed core (stop the bleeding)

### KUBO-152: Derive kid enforcement from the construct, not from kid-writable `featureTepp` (CRITICAL)

**Problem.** `featureTepp` lives in `feedSettings`, synced as the **active user's own**
encrypted kind-30078 (`src/hooks/useEncryptedSettings.ts:124-147`, applied by
`src/components/NostrSync.tsx:336-349`). When the kid is active, the kid's own key
authors that event — so the kid's account state is the master switch for its own
protection. Every enforcement point short-circuits on the flag:
`useKuboTeppGate.ts:75`, `useConstruct.ts:66-67`, `useKuboTeppFeedFilter.ts:52-54`.
This is also the root cause of the per-account oscillation in KUBO-168.

**Fix.** Introduce one derived predicate, e.g. `useTeppEnforced(kidPubkey)` in
`src/lib/tepp-adapters/`, defined as: *the active/target user is a kid in the family* AND
*the family record exists*. The kid's (or parent's) synced `featureTepp` value may turn
enforcement ON but must never turn it OFF for a kid when the parent-side family state has
it on. Concretely: store the authoritative flag in the **family record**
(`useKuboFamily.ts`, parent-controlled, device-local secureStorage) — written by the
EditKidSettingsPage toggle — and have `useConstruct` / `useKuboTeppGate` /
`useKuboTeppFeedFilter` consume the derived predicate instead of
`config.feedSettings.featureTepp`. Keep `feedSettings.featureTepp` only as the
parent-UI-visible mirror for sync/migration compatibility.

**Files.** `src/lib/tepp-adapters/useConstruct.ts`, `src/hooks/useKuboTeppGate.ts`,
`src/hooks/useKuboTeppFeedFilter.ts`, `src/hooks/useKuboFamily.ts`,
`src/pages/EditKidSettingsPage.tsx`, `src/components/NostrSync.tsx` (must not let a
synced `featureTepp:false` from a kid account override the family flag).

**Done when.** With the family flag ON: setting `featureTepp:false` in the kid's synced
settings (simulate via a unit test on the config-merge logic) does NOT disable the gate,
filter, or construct fetch for that kid. Unit test added. Parent toggle still works both
ways. Existing migration tests still pass.

### KUBO-153: Guard `/parent/*` routes; PIN lockout (CRITICAL)

**Problem.** `ParentGateDialog` verifies the PIN in JS and just navigates
(`src/components/auth/ParentGateDialog.tsx:72-74`); the `/parent/*` subtree in
`src/AppRouter.tsx:332-350` has no guard, so `/parent/kid-settings` (with the TEPP
toggle), `/parent/trust/people`, and `/parent/keys` are one URL away from the kid app.
PIN has no retry lockout (`src/hooks/useParentGatePin.ts:14-16`).

**Fix.** (1) Add a `RequireParentGate` wrapper element around the `/parent/*` route
subtree: it checks an **in-memory** (module-level or context) `parentUnlocked` flag that
is set ONLY by a successful `verifyPin` and cleared on navigation out of `/parent/*`,
app background (visibilitychange), and a 10-minute timer. If not unlocked, render the
PIN dialog in place (do not navigate away — preserve the deep link after unlock).
(2) Add lockout to `useParentGatePin`: 5 consecutive failures → 60 s cooldown, doubling.
Persist failure count in memory only (a kid clearing storage just resets the cooldown,
acceptable). (3) `ParentGateDialog` success sets the flag, then navigates.

**Files.** `src/AppRouter.tsx`, `src/components/auth/ParentGateDialog.tsx`,
`src/hooks/useParentGatePin.ts`, new `src/components/auth/RequireParentGate.tsx`.

**Done when.** Direct navigation to `/parent/kid-settings` in a kid session shows the PIN
gate, not the page; after PIN, the original deep link opens; 5 wrong PINs trigger
cooldown with a visible countdown; unlock expires on background/timeout. Browser-verify
per memory rule (tsc+lint is not enough for UI).

### KUBO-154: Fail-closed outbound gate when the construct is loading/absent/error (HIGH)

**Problem.** `useKuboTeppGate.ts:77-84`: `enabled` requires a loaded construct, and
`gate()` silently no-ops otherwise; `useNostrPublish.ts:86` only gates when enabled. So
during cold-start construct load, and on `no-association` / `fetch-failed` /
`decrypt-failed` / `parent-logged-out`, **every kid publish is ungated**. The read side
already holds (KUBO-150, `useKidFeed.ts:129-136`); the write side has no hold.

**Fix.** In `useKuboTeppGate`, when the enforcement predicate (KUBO-152) says this kid is
TEPP-enforced but the construct is not loaded: `gate()` must **throw `TeppDeniedError`**
with a distinct `reason: 'construct-unavailable'` (UI copy: "Hold on, still checking with
your grown-up — try again in a moment"). Keep the documented per-reference fail-open on
`pending` for loaded constructs — that asymmetry is intentional and stays. While the
construct query is merely in-flight (`loading`), prefer a bounded wait (e.g. await the
query promise up to 5 s) before failing closed, so normal cold-start publishes don't
error spuriously.

**Files.** `src/hooks/useKuboTeppGate.ts`, `src/hooks/useNostrPublish.ts` (surface the
new reason in the error toast), callers that swallow errors (`RepostMenu.tsx:90`,
`ReactionButton.tsx:91` — show the TEPP-specific message, see also KUBO-163).

**Done when.** Unit tests: kid + enforcement-on + construct null for each reason →
`gate()` throws; construct loading → waits then throws; construct loaded + pending ref →
does not throw. No regression in the 61-test TEPP suite.

### KUBO-155: Fail-closed read path on `parent-logged-out` and unassemblable construct (HIGH)

**Problem.** Two confirmed fail-opens on the read side: (1) `useKidFeed.ts:129-136`
treats `parent-logged-out` as terminal and proceeds with `allowedAuthors = null` → the
kid feed runs fully unscoped exactly when the parent has logged out of a shared device.
(2) `useKuboTeppFeedFilter.ts:52-58` returns PASS whenever the construct is null for any
reason — so a relay simply withholding the kind-34700 state event (reason
`no-state-event`) disables read filtering entirely on Ditto-side feeds.

**Fix.** When the enforcement predicate (KUBO-152) is on: (1) in `useKidFeed`, treat
`parent-logged-out` (and `no-state-event` / `fetch-failed` beyond the transient window)
as **hold** states — empty feed plus a kid-friendly "ask your grown-up to log in" notice,
not the firehose. (2) in `useKuboTeppFeedFilter`, PASS only when the predicate is off;
with the predicate on and construct null → hide items (return not-visible) rather than
show-all. Keep serving a **cached last-known construct** where possible: in
`useConstruct.ts`, on transient failure return the previous successful construct from the
TanStack cache (`placeholderData: keepPreviousData` or explicit) so brief relay flaps
don't blank the feed.

**Files.** `src/hooks/useKidFeed.ts`, `src/hooks/useKuboTeppFeedFilter.ts`,
`src/lib/tepp-adapters/useConstruct.ts`.

**Done when.** Unit tests for the `teppReady`/terminal matrix in `useKidFeed` including
`parent-logged-out` → held; filter test: predicate-on + null construct → hidden;
keepPreviousData verified (flap a mocked query, construct persists). Browser-check: log
parent out with kid active → notice, not firehose.

### KUBO-156: Harden construct assembly — subject pinning, blacklist/global verification, fail-closed deny-lists (HIGH)

**Problem.** Three confirmed holes in `src/lib/tepp-adapters/useConstruct.ts` +
`construct.ts`: (1) **No client-side subject/author pinning** — association and state
queries trust relay filter compliance; `pickCurrentAssociation` never checks
`event.pubkey === kidPubkey`, `pickCurrentState` never checks `subject === kidPubkey`,
permission `subject` is parsed but never compared (`construct.ts:35` filters guardian+sig
only). A tag-filter-sloppy relay hands kid A kid B's permission set. (2) **Blacklist and
global events bypass signature/guardian checks** (`construct.ts:78-79` forwards them; the
parsers' `signatureValid`/`guardian` fields are dead code). (3) **Missing referenced
blacklist/global event → construct assembles WITHOUT the deny-list**
(`useConstruct.ts:218-228` — and `refetchInterval` stops because a construct exists), so
the parent's blocks silently stop being enforced until the next refetch.

**Fix.** In `useConstruct.ts`: after picking, drop candidates where
`assoc.subject !== kidLower` / `assoc author !== kidLower`; assert
`state.subject === kidLower` and `parsePermission(ev).subject === kidLower` before
inclusion. In `construct.ts` (Kubo-owned reimplementation, freely editable): require
`blacklist.signatureValid && guardianSet.has(blacklist.guardian)` (same for global). In
`useConstruct.ts`: if the state's private/public refs name a blacklist/global id and the
fetched event is missing, wrong-kind, bad-sig, or non-guardian → return
`{construct: null, reason: 'fetch-failed'}` (fail-closed, keeps transient polling) —
missing *permission* events stay fail-closed-per-entry as today.

**Files.** `src/lib/tepp-adapters/useConstruct.ts`, `src/lib/tepp-adapters/construct.ts`.

**Done when.** New `construct.test.ts` + `useConstruct` tests (mock `nostr.query`):
wrong-subject assoc/state/permission rejected; forged (non-guardian) blacklist rejected;
referenced-but-unfetched blacklist → reason `fetch-failed`, NOT a construct; happy path
unchanged. Existing suite green.

### KUBO-157: Association integrity — overflow crash, created_at clamp, guardian pinning, expiration fail-closed (CRITICAL crash / HIGH integrity)

**Problem.** Four related issues around kind-17700 handling: (1) **Crash**: vendored
`parse.ts:58-60` builds `new Date(expiration * 1000).toISOString()`; a finite-but-huge
expiration (`1e20`) throws `RangeError` inside `pickCurrentAssociation` **before** the
signature filter — anyone can publish one forged event with the kid's pubkey as author
field (relays don't verify sigs) and crash the construct query (verified by scratch
test). (2) **Future-dating**: `pickCurrentAssociation` picks max `created_at` with no
upper bound — a kid-signed 17700 dated years ahead permanently wins. (3) **Guardian
substitution**: the guardian set is taken from whatever the winning association names
(`useConstruct.ts:117-118`) — combined with (2), a kid can name their own second key as
guardian and self-govern. (4) Missing/garbage `expiration` currently means
**never-expires** (`parse.ts:35`, picker ignores `parseProblems`). Note: the KUBO-149
TODO premise "the parser requires expiration" is wrong — the picker already accepts
missing expiration; keep the 365d TTL + renewal as-is and tighten instead.

**Fix.** (1) In vendored `parse.ts` (documented deviation, upstreamable): guard the date —
`const validExp = Number.isFinite(expiration) && expiration > 0 && expiration < 8.64e12;`
use `'—'` otherwise; AND treat a present-but-invalid expiration as `expired: true`
(fail-closed). Additionally wrap the per-candidate parse in `pickCurrentAssociation` so a
throwing candidate is skipped, not fatal. (2) In `useConstruct.ts` (Kubo side, no
deviation needed): before picking, drop association candidates with
`created_at > now + 600` (10 min skew). (3) In `useConstruct.ts`: after picking, require
the association's guardian set to **include the family's known parent pubkey**
(`useKuboFamily` parent record, already available at the call site via the hook's
inputs) — if not, treat as `no-association`. (4) Decide deliberately: keep
missing-expiration as accepted (spec-lenient) or reject via `parseProblems` — recommended:
reject candidates whose `parseProblems` include missing-subject/missing-guardian, accept
missing-expiration only because Kubo always emits one (KUBO-166 closes the last
non-compliant emitter).

**Files.** `src/lib/tepp/parse.ts` (+ SOURCE.md deviation note),
`src/lib/tepp-adapters/useConstruct.ts`.

**Done when.** New `parse.test.ts`: overflow expiration doesn't throw and is `expired`;
future-dated candidate dropped; guardian-pinning test in useConstruct tests (association
naming a non-parent guardian → `no-association`). Scratch-verified crash input from the
review (`expiration: '99999999999999999999'`) passes through the full
`pickCurrentAssociation` without throwing.

---

## Phase B — Close enforcement coverage holes

⚠ **Sequencing:** KUBO-161 (relay-hint over-deny) MUST land before or with KUBO-159 and
KUBO-163 — adding render-side evaluation while relay hints hard-deny would blank the kid
feed (the seeded construct grants no relay permissions, and nearly every real note
carries relay hints; verified by scratch test).

### KUBO-158: Kid shell escape via hashtag/relay/other links (HIGH)

**Problem.** `NoteContent.tsx:763-781` renders inline `#tag` → `/t/:tag` and relay links
→ `/r/...` unconditionally; `KidNavigationInterceptor.tsx:125-128` deliberately passes
through any non-npub/note same-origin anchor, even in view-only mode. One tap puts the
kid in `MainLayout` (TagFeedPage — no TEPP filter; bottom nav to `/search`,
`/notifications`, global feeds, compose).

**Fix.** Two layers: (1) In `KidNavigationInterceptor`, default-DENY: only allow-listed
path patterns pass (`/kid/...` and whatever the kid shell legitimately uses); everything
else is blocked (toast or silent no-op), including `/t/`, `/r/`, `/search`. (2) Backstop
in `MainLayout` (or the router): if the active session is a kid (same predicate as
KUBO-152), redirect to `/kid`. Layer 2 also covers raw URL entry on web.

**Files.** `src/components/KidNavigationInterceptor.tsx`, `src/components/MainLayout.tsx`
(or `src/AppRouter.tsx`).

**Done when.** New interceptor unit test matrix (npub/note/nip05/hashtag/relay/external/
unknown × normal/view-only) — hashtag and relay are blocked for kids; MainLayout
redirect test; browser-verify a `#hashtag` tap in the kid feed stays in the kid shell.

### KUBO-159: Render-side TEPP filter in the kid feed + repost author check (HIGH)

**Problem.** The kid home feed enforces only at query time (relay-side author allowlist,
`useKidFeed.ts:100-104`); `KidFeedList.tsx:107-124` applies mute/hide only —
`useKuboTeppFeedFilter` is wired into Ditto's `Feed.tsx` but not the kid app's actual
feed. Concretely exploitable: **reposts** (kind 6/16) from allowlisted authors embed and
fetch originals **by id with no author constraint** (`useKidFeed.ts:268-308`) — an
allowlisted account reposting a blacklisted author puts that content on the kid's screen.

**Fix.** (1) In `useKidFeed`'s query fn, drop repost items whose original author is not
in `allowSet` (cheap, closes the main leak at the source). (2) Add
`useKuboTeppFeedFilter.shouldShow` filtering to `KidFeedList` as defense-in-depth —
this catches event-list/relay-list permissions the author allowlist can't express
(`allowedAuthors.ts:29-32`) and future query legs. ⚠ Requires KUBO-161 first.

**Files.** `src/hooks/useKidFeed.ts`, `src/components/KidFeedList.tsx`.

**Done when.** Unit test: repost of non-allowlisted original is excluded; KidFeedList
test renders a denied-author item → hidden; kid feed still populates in browser
(fresh-onboarding flow from KUBO-148(d), Construct view=12 scenario).

### KUBO-160: Gate at the signer seam — cover all direct-publish paths (HIGH)

**Problem.** The outbound gate exists only inside `useNostrPublish`
(`useNostrPublish.ts:72,86-100`) plus one explicit call in `useZaps.ts:125-145`.
**18 hooks** call `signer.signEvent`/`nostr.event` directly and bypass it — including
`useGroupMessages`/`useGroupActions` (group chat) and others; also the acknowledged
explicit-signer bypass at `useNostrPublish.ts:92` (gate is bound to the *active* user).

**Fix.** Move enforcement to the seam every path crosses: when logins are materialized
into `NUser`s (the login → user mapping used by `useCurrentUser`), wrap each **kid**
user's `signer.signEvent` in a proxy that runs the TEPP outbound evaluation
(construct + `evaluateEvent(event, construct, 'outgoing')`, same semantics as
`useKuboTeppGate`, including KUBO-154's fail-closed rules and the kind-exemption list:
TEPP protocol kinds 17700, request-to-interact gift wraps kind 1059 to the parent,
kind 30078 settings if kept) and throws `TeppDeniedError` on deny. Keep the existing
hook gate as the UX layer (nicer errors, CTA), but the seam is the guarantee. The proxy
needs access to the construct outside React — reuse the TanStack `queryClient` cache via
`fetchQuery` with the same query key `['kubo-tepp-construct', kid, parent]`.

**Files.** wherever logins → users are materialized (find via `useCurrentUser` /
`loginsToUsers`), new `src/lib/tepp-adapters/gatedSigner.ts`, exemption list shared with
`src/hooks/useKuboTeppGate.ts`.

**Done when.** Unit tests: kid-signed kind-1 to a denied author throws at the signer
level even when invoked through a direct `signEvent` call (no React); exempt kinds pass;
parent signer unaffected. Grep-test asserting no kid-signing path exists that doesn't go
through the proxy (document the exemptions). Group chat as parent still works (memory
rule: group ops use `useParentSigner`).

### KUBO-161: Relay-hint references must not hard-deny (HIGH functional — blocks KUBO-159/163)

**Problem.** Vendored `evaluate.ts`: a relay reference (any `p`/`e` tag relay hint or
`r`-tag) with no matching relay allow-list entry → `deny`/`unadmitted`, not redactable →
whole event hard-denied. The seeded construct emits **no** relay permissions
(`seedKidConstruct.ts` emits only 8710/8712), so under evaluator-based filtering nearly
every real note dies (verified by scratch test: admitted author + `["p", kid,
"wss://relay.damus.io"]` → deny).

**Fix.** In vendored `evaluate.ts` (documented deviation, upstreamable — this is arguably
an upstream spec bug): when the construct contains **zero relay permission entries and no
relay blacklist entries**, treat relay references as unrestricted (skip relay
evaluation). When relay lists DO exist, keep current semantics but make relay-hint denies
**redactable on incoming** (the relay hint is metadata, not content). Alternative
considered and rejected: seeding a wildcard relay permission — pollutes the published
construct to encode an evaluator quirk.

**Files.** `src/lib/tepp/evaluate.ts` (+ SOURCE.md deviation note).

**Done when.** Evaluate tests: admitted author + relay hint + empty relay lists →
permit; relay blacklisted → deny still works; relay allow-list present + non-listed
relay on incoming → permit-with-redactions, outgoing → deny (consistent with KUBO-162).

### KUBO-162: Outgoing denies are never redactable (HIGH)

**Problem.** Vendored `evaluate.ts:631-678` (`finalize`): denies on
`event`/`hex-ambiguous` refs in recursion layers downgrade to `permit-with-redactions`
**regardless of direction**, and `useKuboTeppGate.ts:110` blocks only on `'deny'`.
Verified by scratch test: a kid draft with `["q", <blockedNoteId>]` and the blocked note
in cache evaluates to `permit-with-redactions` → the kid publishes a quote-post of
forbidden content. You cannot redact an event you are publishing. Related: nested quotes
deeper than `maxDepth=4` also deny-then-redact (incoming smuggling vector — same fix
gives outgoing hard-deny; for incoming, leave as-is but note it).

**Fix.** In `finalize` (vendored, documented deviation): only classify denies as
redactable when `direction === 'incoming'`; for `'outgoing'`, every deny is hard.

**Files.** `src/lib/tepp/evaluate.ts` (+ SOURCE.md note).

**Done when.** Evaluate test: outgoing quote of denied content → `deny` (the scratch
repro from the review becomes a permanent test); incoming nested case still
`permit-with-redactions`.

### KUBO-163: Read-side gaps — post detail, comments, profiles, favorites (MEDIUM, several)

**Problem.** (1) `KidPostDetailPage.tsx:84-88` bounces denied posts via `useEffect`
`nav(-1)` AFTER full render — deep link to a blacklisted author's post displays for the
whole fetch duration. (2) Same page `:316-365`: NIP-22 comments (kinds 1111/1244) from
arbitrary authors render with no TEPP check. (3) `KidProfileViewPage.tsx`: full profile +
media grid for ANY pubkey, no TEPP. (4) Kid favorites render saved events without
re-checking current trust (revoked/blacklisted authors persist).

**Fix.** (1) Render-gate: while the verdict is unsettled show a loading skeleton, and on
deny render a kid-friendly `<BlockedContent/>` card — never the content
(`if (!teppVerdict.visible) return`). (2) Filter comment authors through
`useKuboTeppEvaluateAuthor` (author-level check, no closure fetch needed). (3) In
`KidProfileViewPage`, evaluate the profile's author; deny → blocked card. (4) In the
favorites view, run items through `useKuboTeppFeedFilter`. ⚠ Requires KUBO-161.

**Files.** `src/pages/kid/KidPostDetailPage.tsx`, `src/pages/kid/KidProfileViewPage.tsx`,
the favorites view in `src/pages/kid/KidHomePage.tsx`.

**Done when.** No flash: a denied deep link never paints post content (verify in browser
with throttled network); denied-author comments hidden; denied profile shows blocked
card; revoked favorite hidden. Component tests for each.

### KUBO-164: Kind-3 must not brick on one unadmitted follow (MEDIUM)

**Problem.** The gate evaluates kind 3 at view threshold (`useKuboTeppGate.ts:38,98`)
but the evaluator hard-denies ANY unadmitted p-tag, and kind 3 carries the whole list.
After a parent clears trust for someone the kid follows (trust `clear` does not edit the
kid's kind 3), **every** subsequent follow/unfollow publish is denied.

**Fix.** Two parts: (1) In `useKuboTeppGate`, for `RECORD_LIST_KINDS`, evaluate only the
**delta** vs the kid's previous kind-3 (fetch current via the existing follow hooks):
newly-added p-tags must be admitted at view; pre-existing entries are carried. (2) In
`useTrustAssignments.clear` (parent side), also unfollow the cleared pubkey from the
kid's kind-3 via the existing `unfollowMany` helper — keeps list and trust coherent
(mirrors the KUBO-148 "trust before follow" model in reverse).

**Files.** `src/hooks/useKuboTeppGate.ts`, `src/hooks/useTrustAssignments.ts`,
`src/hooks/useFollowActions.ts` (reuse `unfollowMany`).

**Done when.** Test: kind-3 containing a stale unadmitted follow + one newly-added
admitted follow → permitted; newly-added unadmitted follow → denied. Clearing trust
unfollows (test via store mock).

### KUBO-165: Reference-extraction hardening (MEDIUM)

**Problem.** Confirmed false negatives in vendored `references.ts` (unextracted = can't
be denied = fail-open): (1) regexes are lowercase-only (`:76-80,137`) — `NOSTR:NPUB1…`,
uppercase bare bech32 (valid per bech32 spec), and uppercase 64-hex escape extraction
entirely (verified: 0 refs extracted). (2) NIP-10 `e`-tag author pubkey at index 4 never
extracted (`:95-99`) — a reply with no p-tag relies on fetch-dependent recursion that
fails open on `pending`; combined with an unfetchable parent this is a working publish
bypass. (3) bare-hex `unadmitted` hard-denies legit notes containing txids/hashes
(`evaluate.ts:434-442`) — over-block. Also (privacy of scope: bech32/hex inside URLs are
partially caught; full URL-content extraction is a larger upstream change — note it, do
not build it now).

**Fix.** In vendored `references.ts` (+ `evaluate.ts` for #3; documented deviations):
(1) add `i` flag to `BECH32_*`, `HEX_BARE`, `nostrTokenRe`; lowercase tokens before
`nip19.decode`. (2) when an `e`-tag has a 5th element matching 64-hex, also push a
`pubkey` reference. (3) make bare-hex `unadmitted` denies redactable on **incoming**
(outgoing stays hard per KUBO-162).

**Files.** `src/lib/tepp/references.ts`, `src/lib/tepp/evaluate.ts` (+ SOURCE.md notes).

**Done when.** New `references.test.ts`: uppercase nostr-token/bech32/hex extracted;
e-tag index-4 author extracted; existing extraction unchanged (snapshot the review's
verified cases). Evaluate test: incoming note with random txid hex → visible
(redacted), outgoing reply e-tagging an unadmitted author via index 4 → denied without
needing the parent event fetched.

---

## Phase C — Lifecycle & divergence correctness

### KUBO-166: `seedKidConstruct` must use `assocExpiry` (HIGH — confirmed by two reviewers)

**Problem.** `src/lib/tepp-adapters/seedKidConstruct.ts:21,152` hardcodes a **30-day**
association TTL — a third 17700 publish site that escaped KUBO-149 (the other two
correctly import `assocExpirationAt`). Every fresh onboarding ships a 30d fuse (and,
since 30 < 60d renewal window, immediately double-publishes a 365d assoc on the next kid
session). Also: one shared 8 s `AbortSignal.timeout` covers pack expansion PLUS five
sequential publishes (`:136`) — slow pack fetch can abort the seed mid-sequence, the
exact partial-construct state it exists to prevent; and the kid kind-3 seed publish is
the only unaudited event (`:230-241`).

**Fix.** Import and use `assocExpirationAt()` from `./assocExpiry`; delete the local
constant. Give the pack-expansion fetch its own timeout separate from the publish
budget (e.g. 8 s fetch + fresh 8 s for publishes). Add the kind-3 publish to the audit
log. Add the lint-style test from the review: a unit test that greps `src/` asserting
every `buildAssociationTemplate` call site imports from `assocExpiry` (this is how the
30d hardcode survived KUBO-149 — make drift impossible).

**Files.** `src/lib/tepp-adapters/seedKidConstruct.ts`,
`src/lib/tepp-adapters/seedKidConstruct.test.ts` (pin the TTL == `ASSOC_TTL_SECONDS`),
new grep-test.

**Done when.** TTL test pins 365d; grep-test fails if any future caller hardcodes;
existing seed tests green.

### KUBO-167: Trust-request approval must publish TEPP (HIGH)

**Problem.** `src/pages/ParentAlertsPage.tsx:240-250` approves a kid's
request-to-interact via the store-only `approveTrustRequest` (localStorage). With
TEPP on (now default), the construct never admits the target: the kid sees "approved"
but stays denied **forever** — and the no-downgrade invariant then blocks
`setLevelIfUnassigned` from ever re-granting. Permanent divergence, no reconcile covers
it. (`docs/tepp-integration.md` §Request-to-Interact documents the correct behavior.)

**Fix.** Route approval through `useTrustAssignments(alert.kidPubkey).setLevel(target,
'interact')` (which publishes 8710 + state when TEPP is on AND writes localStorage),
then clear the pending request. Make the two steps one user-visible operation with
error handling: if the publish fails, do NOT clear the request (so approval can be
retried) — note this ordering explicitly.

**Files.** `src/pages/ParentAlertsPage.tsx`, possibly `src/hooks/useTrustAssignments.ts`
(an `approveRequest` convenience that wraps setLevel + clearTrustRequest atomically).

**Done when.** Test: approving with TEPP on calls the permission+state publish path and
clears the request only on success; with TEPP off, localStorage-only as before. Browser
QA: kid requests → parent approves → kid can interact (extends the KUBO-145 QA list).

### KUBO-168: Fix the default-ON migration's account/device mismatch (HIGH)

**Problem.** `src/hooks/useTeppDefaultOnMigration.ts`: (1) The kind-30078 settings are
**per-account** (active user authors them) but the migration guard is **per-device**
(`kubo:tepp-default-on-migrated`) — it flips only the account active at first run
(usually one kid); other logins keep `featureTepp:false` and NostrSync re-applies it on
every account switch → per-account oscillation, the exact bug class KUBO-151 was built
to end. The "all kids" toggle in `EditKidSettingsPage.tsx:378-386` has the same
per-account defect. (2) Device B re-flips a user who deliberately turned TEPP off on
device A (guard is device-local, no epoch check). (3) On write failure the effect
hot-loops retries every render with no backoff (`:91-96` — `ranRef` reset + unstable
effect deps).

**Fix.** Note: KUBO-152 (family-level flag) removes the root cause; this task makes the
migration consistent with it. (1) Key the guard per-account
(`kubo:tepp-default-on-migrated:<pubkey>`) and run the flip for **each** logged-in
nip44-capable login, not just the active one — or, once KUBO-152 lands, migrate the
family flag once and stop writing per-account `featureTepp` entirely (preferred; do
KUBO-152 first and simplify here). (2) Before flipping an account, skip if its existing
synced settings event is newer than the KUBO-151 release epoch (a deliberate post-release
choice must win). (3) On failure set `ranRef.current = true` (localStorage flag unset
already gives next-boot retry, matching the code comment's promise).

**Files.** `src/hooks/useTeppDefaultOnMigration.ts`,
`src/pages/EditKidSettingsPage.tsx`, coordination with KUBO-152.

**Done when.** Tests: multi-login flip covers all accounts (or family-flag variant);
post-epoch `false` not re-flipped; failed write does not retry within the same boot
(assert one mutate call). Fix the KUBO-150→KUBO-151 attribution comment at `:10`.

### KUBO-169: Reconcile against the construct, not localStorage (HIGH)

**Problem.** The published construct and localStorage diverge permanently in several
confirmed scenarios because reconcile/grant paths use localStorage as the oracle:
(1) `useTrustAssignments.setLevelsBatch` early-returns when localStorage didn't change
(`useTrustAssignments.ts:214-215`) — BEFORE the publish block — so pack members
assigned-while-TEPP-off, or whose batch publish once failed (`:246-253`), are never
published; `useEnsureParentTrust` phase 2 then finds nothing to do, forever
("NOT ADMITTED" recurrence of KUBO-148(d) via another path). (2) `useAddFeedProfile`
(`:50-53`): failed publish but localStorage written → `setLevelIfUnassigned` returns
false forever, no retry. (3) `useTrustAssignments.clear` publish failure: revoked person
stays admitted on the wire, UI shows them gone, no retry path.

**Fix.** Make the construct the oracle for "published": (1) extend `useEnsureParentTrust`
phase 2 to diff enabled-pack members against the **construct's view entries** (pattern
already exists as `constructHasInteract` in phase 1) and publish the missing set via the
existing batch path, bypassing the localStorage-changed check. (2) Add a third reconcile
phase: diff ALL of `family.trustAssignments[kid]` against construct entries and
re-publish missing grants (covers individual profiles and failed setLevel publishes).
(3) For `clear` failures: keep a `pendingRevocations[kid]` list in the family store; the
reconcile phase retries revocations (publish permission-without-target + state) until the
construct no longer admits the target, then clears the marker. Throughout, respect the
existing once-per-kid-per-session guards and the no-downgrade invariant.

**Files.** `src/hooks/useEnsureParentTrust.ts`, `src/hooks/useTrustAssignments.ts`,
`src/hooks/useKuboFamily.ts` (pendingRevocations), `src/hooks/useAddFeedProfile.ts`.

**Done when.** Tests: construct missing a localStorage-granted member → reconcile
publishes; failed clear → retried next session until construct drops the entry; no
publish when construct already matches (no churn — assert zero mutate calls on a
matching pair). The KUBO-148(d) browser scenario re-verified.

### KUBO-170: Relay `extend` tier — shrink-clobber and silent permanent grant (MEDIUM)

**Problem.** `src/hooks/useRelayTrustAssignments.ts`: `setLevel('extend', …)`
(`:112-117`) publishes the shared `${kid}:interact:relay` d-tag event with ONLY the new
URL (the `sameTierExisting` filter always yields `[]` for extend), dropping every
existing interact-tier relay from the wire; `setLevel('interact', …)` symmetrically
drops extend-tier relays; `clear()` of an extend relay returns early (`:159`) so the
relay stays admitted in the published 8714 forever; and the extend publish is recorded
under the `interactRelay` ref slot (`:126-131`).

**Fix.** Build every publish of that d-tag from the **union** of interact ∪ extend tiers
(the pattern `teppMigration.ts:175` already uses); on `clear` of an extend relay,
publish the shrunken union (a real revocation); record the ref under the correct slot.

**Files.** `src/hooks/useRelayTrustAssignments.ts`.

**Done when.** New round-trip test: set interact A, extend B → published list {A,B};
clear B → published {A}; refs recorded under one consistent slot; state refs stay
coherent.

### KUBO-171: Serialize kind-34700 publishes per kid; self-source refs (MEDIUM)

**Problem.** All 34700 publishers carry the full ref set *as snapshotted at sign time*,
but flows run concurrently (`useEnsureParentTrust` fires phase 1 and phase 2 in the same
tick; migration can race manual Trust-page actions; two tabs) — the last writer's
snapshot wins and can drop a ref recorded between snapshot and publish (KUBO-143/148(d)
class). Same-second `created_at` ties resolve by lowest-id — nondeterministic.

**Fix.** In `useKuboTeppPublishState` (`src/hooks/useKuboTeppPublish.ts`): (1) read the
ref set via `readLatest()` INSIDE the mutation, not from a caller-supplied snapshot;
(2) serialize per-kid behind a module-level promise chain
(`stateChain[kid] = stateChain[kid].then(publish)`); (3) when replacing within the same
second as the previous publish, bump `created_at` by +1 to make replaceable ordering
deterministic. Callers stop passing refs.

**Files.** `src/hooks/useKuboTeppPublish.ts`, call sites in `useTrustAssignments.ts`,
`useRelayTrustAssignments.ts`, `useTeppMigration.ts` (order-5 keeps its own readLatest —
verify it routes through the same serialized path or is documented as boot-only).

**Done when.** Test: two interleaved setLevel calls → final published state refs are the
union (simulate with promise interleaving); created_at strictly increases across rapid
publishes.

### KUBO-172: `removeKid` teardown (MEDIUM)

**Problem.** `src/hooks/useKuboFamily.ts:283-307`: removing a kid leaves
`relayTrustAssignments[kid]` and `teppLatestPermissionIds[kid]` in the store and
publishes NO revocation — the kid's published construct (17700 up to 365d, 34700 +
permissions indefinitely) stays live after removal.

**Fix.** Clean both leftover maps. When TEPP is on, before store removal publish a
teardown: a state event with empty refs (the one case where an empty-refs 34700 is
CORRECT — comment this loudly, given the KUBO-148(d) history) — guardian-signed, so it
works without the kid logged in. Optionally also a final short-expiry association
rotation if the kid IS logged in.

**Files.** `src/hooks/useKuboFamily.ts` (removeKid), `src/hooks/useKuboTeppPublish.ts`
(teardown helper).

**Done when.** Test: removeKid clears both maps and (TEPP on) publishes an empty-refs
state for that kid only; other kids' state untouched.

---

## Phase D — Privacy (design + implement; coordinate with upstream)

### KUBO-173: Stop publishing the kid's social graph in plaintext to public relays (HIGH privacy)

**Problem (confirmed).** TEPP events route through the default `eventRouter`
(`src/components/NostrProvider.tsx:209-230`) with no kind-specific routing → they fan
out to public write relays. Permission lists (8710/8712/…)
are plaintext p/r/e tags (`buildEvents.ts:114-149`), blacklist (8720) and global
restrictions (8721, incl. allowed-time windows = a minor's daily schedule) are plaintext,
and the kid-signed 17700 names the guardian — public, permanent kid↔parent linkage. The
34700's NIP-44 private section only hides ref ids whose target events are themselves
public. Net: anyone can read the complete allow-list, block-list, and schedule of a
specific minor.

**Fix (two independent steps; do (1) now, (2) needs design).**
(1) **Relay routing**: add kind-aware routing in `eventRouter` — TEPP kinds
(17700, 34700, 8710–8717, 8720, 8721) publish ONLY to the family's private relay set
(the existing private-relay infra from the nostr-relays project; make the set
configurable in family settings, default to the kid's configured private relay if one
exists, else warn the parent in EditKidSettingsPage that TEPP data is public).
`useConstruct`/`pool.ts` query the same set first.
(2) **Content encryption**: move permission/blacklist/global list contents into
NIP-44-encrypted event content (parent↔kid conversation key), keeping only the d-tag
plaintext. This changes the wire format → file an upstream issue first (ngit, see
`gitworkshop-ngit.md` memory) and implement behind a version tag the parsers can detect.
Do not ship (2) unilaterally; ship (1) immediately.

**Files.** `src/components/NostrProvider.tsx` (eventRouter),
`src/lib/tepp-adapters/pool.ts`, `src/lib/tepp-adapters/useConstruct.ts`,
`src/pages/EditKidSettingsPage.tsx` (relay setting + warning), upstream issue for (2).

**Done when.** (1) Unit test on the router: kind-8712 event routes only to the family
relay set; construct still assembles end-to-end against that set; public relays receive
nothing (assert router output). Upstream issue filed and linked in TODO.md for (2).

---

## Phase E — Tests, polish, small fixes

### KUBO-174: Adversarial + structural test suite (HIGH value)

The reviews found the security boundary has near-zero coverage. Add, in this order of
value (each is a small, independent test file — good fan-out for parallel agents):

1. `parse.test.ts` / `parseState.test.ts` / `parsePermission.test.ts` /
   `parseBlacklist.test.ts` / `parseGlobal.test.ts` — first parser tests ever: overflow
   expiration (KUBO-157 repro), future-dated created_at pick, expired assoc, missing
   tags, duplicate tags, subject≠d mismatch (parseState), mode-B/extend validation.
2. `construct.test.ts` — forged/non-guardian permission & blacklist & state rejected;
   subject pinning; missing referenced blacklist → no construct (KUBO-156 cases).
3. `useKuboTeppGate` tests — deny throws; construct-null fail-closed matrix (KUBO-154);
   RECORD_LIST_KINDS delta logic (KUBO-164); pending fail-open preserved.
4. `useKuboTeppFeedFilter` / `useTeppReferenceCache` — isResolving behavior, pending
   never cached, fingerprint re-key on construct change, predicate-off PASS.
5. `useKidFeed` — repost author filtering (KUBO-159), teppReady hold matrix incl.
   `parent-logged-out` (KUBO-155).
6. `references.test.ts` — KUBO-165 cases + smuggling corpus (nested quotes, naddr,
   uppercase, URLs-containing-ids as documentation of known limits).
7. `runMigration` integration tests (mock relay): resume-after-crash at each order
   boundary, assoc-skip-then-retrigger, order-5 refs attached, two-tab double-run
   converges.
8. `useEnsureKidAssociation` — guard sharing, expired-assoc recovery, defer-without-
   marking when signer absent.
9. Evaluator ordering pin: hard author-deny beats `pending` in `finalize` (the property
   the whole fail-open design leans on — must never regress silently).

### KUBO-175: Small fixes batch (LOW, one commit)

- Remove `[TEPP-DBG]` console.logs: `useKuboTeppEvaluateEvent.ts:61,68,73`.
- `teppAuditLog.ts:65`: `{ ts: entry.ts ?? Date.now(), ...entry }` → spread first, then
  default (`{ ...entry, ts: entry.ts ?? Date.now() }`).
- `useConstruct.ts:52-56`: fix the doc comment claiming the assoc id is in the query key
  (it isn't); route assoc/state query throws to reason `'fetch-failed'` instead of a
  reason-less error; add backoff to the 1.5 s transient poll and cap `decrypt-failed`
  retries.
- `useKuboTeppEvaluateAuthor.ts:62`: add the `result !== 'pending'` guard before caching
  (consistency); `useKuboTeppEvaluateEvent.ts:132`: return the deciding direction's raw
  verdict, not always inbound.
- `NoteCard.tsx:362`: pass the event to `useActionVisibility()` so the kid feed gets
  per-event interaction gating + the "ask to interact" CTA path that `PostActionBar`
  already has; surface `TeppDeniedError` distinctly in `RepostMenu.tsx:90` /
  `ReactionButton.tsx:91`.
- `ParentTrustDiagnosticsPage.tsx:421-425`: prefetch the reference closure before
  TestEventPanel's `evaluateEvent` (otherwise replies always read `pending`); fix the
  `[]`-deps audit-log memo at `:57`.
- Verdict cache time-bucket: when the construct contains any timed restriction, include
  a 15-min time bucket in the cache key (or a TTL) so a "4–6 pm" permit doesn't keep
  admitting at 9 pm (`verdictCache.ts` + call sites).
- `evaluate.ts:557-558`: replace magic `8713` with the named constant and fix the wrong
  "intentionally omitted" comment (SOURCE.md deviation note).
- `restrictions.ts:38`: restrict `parseKindList` to `/^\d+$/`; document the half-open
  `[start,end)` time-window boundary (`:83-87`).
- Mark `teppSignerFromNUser` and `makeTeppPool` as `@internal` upstream seams (zero
  production call sites — comment so nobody "fixes" the arg swap).
- `useTeppMigration.ts:364`: unify the order-6 kid lookup onto `useKidSigner`'s helper
  for the typed reason taxonomy.
- Pack UX: `useAddFeedPack.ts:83-87` unfollows members shared with other enabled packs;
  `useEnsureParentTrust.ts:147` re-follows manually-unfollowed pack members every
  session — compute the union of still-enabled packs before unfollowing, and make the
  reconcile follow only members never-followed (not re-follow removed ones).

---

## Known-accepted limitations (document, don't fix now)

- Fail-open on `pending` for **incoming** content whose author is admitted: intentional,
  bounded by closure caps (depth 4 / 500 ids / 4 s). KUBO-154/162/165 remove the
  outgoing half.
- Client-side enforcement cannot stop a devtools-capable kid (see threat-model note).
- Bech32/hex smuggled inside URLs query strings and media link targets are not extracted
  (KUBO-165 notes the limit; full URL-content extraction is an upstream design change).
- Multi-device parenting is unsupported: `kubo:family` (trust + ref ids) is device-local;
  a second parent device would clobber published lists. Single-device by design — keep
  the existing comment in `useKuboFamily.ts:6-10` and revisit only if multi-device
  becomes a requirement.

## Suggested execution order for agent fan-out

1. **Wave 1 (independent):** KUBO-157, 166, 175 (small, surgical, high confidence).
2. **Wave 2:** KUBO-152 → then 153, 154, 155, 168 (they consume the predicate).
3. **Wave 3:** KUBO-156, 161 → then 159, 162, 163, 164, 165 (evaluator changes first).
4. **Wave 4:** KUBO-158, 160, 167, 169, 170, 171, 172.
5. **Wave 5:** KUBO-173(1) routing, KUBO-174 test suite (parallelizes well per file).
6. KUBO-145 manual QA walkthrough last, extended with the new browser checks named in
   each task's "Done when".

After each task: tsc + eslint + vitest + (UI tasks) browser verification on the dev
server, then commit to `brand/main` with the KUBO number in the message, and update
TODO.md/DONE.md per agent.md.
