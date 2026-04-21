# Kubo — TODO

Issue prefix: `KUBO-xxx`

## Open

- **KUBO-001: Upload flow — parent posts, signed by kid's key**
  Upload UX lives in the parent app, but the resulting event is signed with the kid's private key (the parent is acting on behalf of the kid, not posting from their own identity). Relevant to PR 4 (Upload). Figure out key-access model: does the parent hold the kid's nsec, unlock it per-upload, or sign via a delegation/NIP-46-style handoff?

- **KUBO-007: Single-device MVP onboarding — 3 screens, no QR**
  For MVP, parent and kid share one device, so drop the multi-device handoff from the onboarding flow. No QR screen, no "add kid from another device" path. Likely 3 screens total instead of 5–6 — revisit PR 2 stub routes (`/onboard/welcome`, `/onboard/create-parent`, `/onboard/add-kid`) against this simpler shape.

- **KUBO-008: Request-to-watch mechanism (same device)**
  Kid taps something they're not currently allowed to see → generates a request that surfaces in the parent's Alerts tab (PR 6). Parent approves/denies in-app. No cross-device messaging needed for MVP since it's all on one device — in-app state / local event store is enough.

- **KUBO-010: Backup keys page — parent-side retrieval of the logged-in kid's npub/nsec**
  New "Backup keys" tile on `/parent/kid/:id` dashboard opens `/parent/kid/:id/keys`. Shows the logged-in kid's npub (always visible, safe to share) and nsec (masked, Eye reveal + amber warning, Copy button, "Back Up Key" via `saveNsec`). Reads from `logins[0]`, mirroring the `BackupKeySection` pattern in `ProfileSettings.tsx`.

- **KUBO-011: App-wide biometric / device-PIN gate for nsec reveal and export**
  Neither Kubo nor upstream Ditto currently gates nsec reveal behind any authentication — the Eye toggle in `KidKeysPage`, `ProfileSettings.BackupKeySection`, and `InitialSyncGate` is a plain `useState`. Install a Capacitor biometric plugin (e.g. `@capacitor-community/biometric-auth`) with a web fallback (AlertDialog "type NSEC to confirm"), and wrap the reveal/export paths with a shared `<RequireAuth>` helper so the gate covers both parent and kid nsec surfaces.

- **KUBO-012: Trust/Places — wire to kid's NIP-65 + BUD-03 via signer-swap** *(BLOCKED by KUBO-016)*
  Replaced the hardcoded 4-item placeholder on `/parent/kid/:id/trust/places` with reused `<RelayListManager />` + `<BlossomSettings />` under the kid's signer, factored the swap into a `useEditAsKid` hook, and refactored `EditKidFeedSettingsPage` onto the same hook. **Browser-verified to crash** (Max-update-depth in a `<Switch>` inside an `ErrorBoundary`): see KUBO-016 — the underlying signer-swap pattern blows up as soon as Ditto components that read per-user state mount after `setLogin` fires. Same crash reproduces on the original pre-refactor `EditKidFeedSettingsPage`, so it's not the hook extraction — it's the pattern. Code stays on `brand/main` for continuity but the route is non-functional until KUBO-016 is resolved.

- **KUBO-013: Trust level semantics (Extend / Interact / View) for relays & Blossom servers**
  Follow-up to KUBO-012. Design the mapping of the three trust levels onto NIP-65 read/write markers (or a new kid-scoped `kind:30078` entry keyed by relay URL). Restore the `TrustLegend` + per-row trust-badge UX on top of the functional list from KUBO-012.

- **KUBO-016: Signer-swap render-loop crash on `/parent/kid/:id/feed-settings` and `/trust/places`**
  Pre-existing bug exposed by browser verification of KUBO-012. Symptom: after `setLogin(kidLoginId)` fires in `useEditAsKid` (previously inline in `EditKidFeedSettingsPage`), the target page throws *Maximum update depth exceeded* in a Radix `<Switch>` (`setRef` inside an `Array.map` in `dist-D0IwgzoO.js`) and the ErrorBoundary takes over. `/settings/network` with the same `<RelayListManager />` + `<BlossomSettings />` under a stable login renders fine, so the trigger is the account-switch cascade, not those components. Likely culprit: one of the `updateConfig`-in-effect blocks in `NostrSync.tsx` (relayMetadata sync, Blossom sync, or encrypted-settings sync — all depend on `user?.pubkey` and call `updateConfig(...)` on every run) fires repeatedly when the kid's `kind:10002`/`30078` events haven't been seeded into the query cache yet, feeding back into itself via `config.*.updatedAt` deps. Repro: `python3 /tmp/kubo-trust-places-verify.py` against `npm run dev`. Fix direction: make the NostrSync effects idempotent against "event not yet fetched" state (skip `updateConfig` if the fetched event is older than `updatedAt`, or gate on `isFetched` rather than presence of data).

- **KUBO-009: Handle returning-user-on-new-device case in onboarding**
  After shortening the onboarding flow (Welcome → Create parent → Create kid), a returning Kubo user logging in on a fresh browser/device (no local settings, no remote settings discoverable within the 8s sync timeout) will have Kubo default `feedSettings` + `contentWarningPolicy: "blur"` silently written over whatever they had before. Low-risk while Kubo is new, but revisit when cross-device returning-user flow becomes a concern. Likely fix: detect "this user just came through `/onboard/create-parent`" vs. "this is an existing nsec login from elsewhere" and only apply silent defaults in the former case.

- **KUBO-021: Videos tab — trust-scoped filtering**
  Follow-up to KUBO-020. `VideosTab` on `/parent/profile/:npub` currently shows every media event from the creator, unfiltered. Once KUBO-013 defines the trust-people list kind, filter `useProfileMedia` results by the current kid's trusted-authors set (or the kid's active trust level) so the grid matches what the kid is allowed to see. Probably a thin wrapper hook `useKidScopedProfileMedia(pubkey, kidId)` that post-filters the infinite query pages.

- **KUBO-022: Videos tab — infinite scroll**
  Follow-up to KUBO-020. `VideosTab` only renders the first `useProfileMedia` page (~20 events). Wire an IntersectionObserver sentinel at the bottom of the grid that calls `fetchNextPage()` when visible, using the hook's already-implemented `getNextPageParam`.

## Deferred to post-MVP

- **KUBO-002: Separate devices** — parent and kid on distinct devices rather than sharing one; requires some transport between them (pairing, key sync, etc.).
- **KUBO-003: Parent keypair usage** — first-class parent identity with its own nsec (not just a signer-for-kid). Needed for guardian-list events, co-signing, parent-to-parent trust.
- **KUBO-004: Guardian list kind** — custom Nostr kind listing authorized guardians for a kid account. Schema design + NIP-style doc.
- **KUBO-005: Co-signing / recovery** — multi-guardian threshold signing on sensitive actions (key rotation, account recovery, trust-domain edits).
- **KUBO-006: QR handoff** — secure pairing between parent and kid device via QR (initial setup, device swap, guardian addition).
