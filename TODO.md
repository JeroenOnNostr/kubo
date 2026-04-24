# Kubo — TODO

Issue prefix: `KUBO-xxx`

## Open

- **KUBO-001: Upload flow — parent posts, signed by kid's key**
  Upload UX lives in the parent app, but the resulting event is signed with the kid's private key (the parent is acting on behalf of the kid, not posting from their own identity). Relevant to PR 4 (Upload). Figure out key-access model: does the parent hold the kid's nsec, unlock it per-upload, or sign via a delegation/NIP-46-style handoff?

- **KUBO-008: Request-to-watch mechanism (same device)**
  Kid taps something they're not currently allowed to see → generates a request that surfaces in the parent's Alerts tab (PR 6). Parent approves/denies in-app. No cross-device messaging needed for MVP since it's all on one device — in-app state / local event store is enough.

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

- **KUBO-027: Kid mode "view only" interaction gate**
  Follow-up to KUBO-026. Kids currently follow Ditto's `NoteCard` default tap behavior — tapping a non-video card navigates to a detail page, tapping a profile avatar navigates to a profile page, etc. For strict "view-only" kid mode, intercept these to either do nothing or require a parent gate. Design decision required: global toggle or per-kind ("can navigate to profiles but not to articles")? Also define whether the kid should see interaction affordances at all (zap buttons, reply icons) on a view-only screen.

- **KUBO-028: Real video categorization model**
  Category chips (All / Animals / Music / Craft / Stories) were removed in KUBO-026 because NIP-71 video events rarely carry `#t` topic tags, making non-"All" selections return empty feeds. Reintroduce once there's a backing data model: our own addressable event, a NIP-50 search query per category, an ML-based classifier running on thumbnails/titles, or an adopted `#t` convention. Until then, the chips were misleading UI.

- **KUBO-024: Restructure parent home — drop redundant tiles, move Backup keys, add activity placeholders**
  On `/parent/home`, removed the three nav tiles that duplicate bottom-nav destinations (Trust · People → Trust tab, Trust · Places → Trust tab, Activity & alerts → Alerts tab) and moved the Backup keys tile into `/parent/kid-settings` where it belongs with the per-kid config knobs. Extracted `NavTile` from `KidDashboardPage.tsx` to `components/NavTile.tsx` so both pages can share it. Added two placeholder sections below the remaining tiles on the home page: **Kids watch history** (horizontal row of 3 dummy thumbnail cards) and **Kids activity** (shadcn Tabs for Week/Day + a recharts BarChart with 3 kids × 7 days of hardcoded sample data, plus a legend). Visual-only — no data wiring. Follow-up in KUBO-025.

- **KUBO-025: Wire Kids watch history + Kids activity placeholders to real data**
  Follow-up to KUBO-024. Replace the hardcoded `ACTIVITY_DATA` + 3 dummy watch-history cards on `/parent/home` with live readings. Watch history: recent-views from the active kid's signer (kind TBD — likely the same events that feed `/kid`'s tile tap, ordered by `created_at`). Activity chart: per-kid daily watch time aggregated from kid-settings/usage events across the parent's kids (iterate `useKuboFamily().kids`, switch signer per kid or query by pubkey). Week tab aggregates by day-of-week, Day tab aggregates by hour. "Watch full history" span becomes a link once the target route exists.

- **KUBO-035: Prune inherited Ditto feature branches from the fork**
  The GitHub fork (converted 2026-04-21 from the pre-existing `JeroenOnNostr/ditto` fork) carries ~50 branches from upstream Ditto (`ios-haptics`, `planet`, `reactions`, `bluesky`, `develop`, `dms`, all the `feat/blobbi-*`, etc.). These clutter the branch list and aren't Kubo work. Delete them from `origin`; they still exist on `upstream` (soapbox-pub/ditto) so nothing is lost. Leave `main`, `brand/main`, and any active `feat/kubo-*` branches alone.

- **KUBO-036: Merge upstream Ditto v2.10.3 into `brand/main`**
  Upstream Ditto has 7 commits on `main` that aren't in `brand/main` yet: lightbox swipe-to-dismiss flicker fix, release 2.10.3, iOS status-bar text color fix on light theme, envelope-card mobile tap fixes, swipe-to-dismiss on lightbox overlays, wall compose-box clearing, autoplay-videos setting. Local `main` has already been fast-forwarded to `upstream/main`; follow the flow in memory note [kubo.md](../../.claude/projects/-home-jeroen-VScode-workspace-for-building-nostr-apps/memory/kubo.md): `git checkout brand/main && git merge main`, resolve any brand-specific conflicts, `git push origin brand/main`. Watch for conflicts on files Kubo has rebranded/customized.

- **KUBO-037: Set up Android release-signing keystore**
  v0.1.0 and v0.1.1 APKs are debug-signed (shared dev key across all developers' machines) — fine for personal testing but blocks Play Store distribution, means users can't cleanly update to a release-signed build later, and gives no signing-identity guarantee. Run `npm run keygen` to generate an upload keystore, fill in `android/key.properties` with the alias/passwords, and the existing `signingConfigs.release` block in `android/app/build.gradle` will pick it up. Store the keystore + passwords somewhere durable (losing them means losing the ability to update the app). Only unblock once we're ready to distribute beyond Jeroen's own device.

- **KUBO-052: Parent feed view — wire the search bar or remove it**
  The search pill on `/parent/feed` (`ParentFeedPage.tsx:64-68`) is a placeholder ("wired in a later pass"). Either wire it to filter the source list / do a NIP-50 search, or delete it. Decide whether it's actually needed at this level — sources are already listed below it.

- **KUBO-053: Parent feed view — untruncate descriptions on "Edit feed settings" and "Feed preview" tiles**
  The two tiles at the top of `/parent/feed` have their descriptions clipped (line-clamp / truncate). Let them wrap fully so the subtitle is readable.

- **KUBO-054: Parent home — merge "Today's usage" bar into the Kids activity chart**
  On `/parent/home` (`KidDashboardPage.tsx:111-131` and `KidDashboardPage.tsx:153-175`) the "Today" used/limit bar and the Day tab of the Kids activity card show essentially the same thing. Condense to a single block to save vertical space — e.g. drop the standalone "Today" card, or fold its progress bar into the Day tab.

- **KUBO-057: Select communities page — improve search reliability**
  On `/parent/feed/communities` (`CommunitiesSourcePage.tsx`) the search pill (`CommunitiesSourcePage.tsx:58-64`) returns inconsistent results for kind-34550 community queries. Audit the NIP-50 query, relay set, and result dedupe.

- **KUBO-059: Parent feed profiles — expandable tiles and profile picture navigation**
  On the parent feed profiles page, profile tiles should be tappable to expand downward and reveal the profile's description/about text. Tapping the profile picture (avatar) should navigate to the full profile view screen. Currently neither interaction is wired up — tiles are static and avatars don't link anywhere.

- **KUBO-060: Kid view — Favorites navbar item has no "add to favorites" affordance**
  The kid view's bottom navbar has a Favorites tab but there is no way to actually mark a post as a favorite from anywhere in the kid UI. Explore whether to reuse the existing bookmarks functionality (NIP-51 kind:10003 bookmark list, or kind:30003 categorized bookmarks) or design a kid-specific mechanism. Decide on the data model first, then add the "favorite" affordance on cards/video tiles in the kid feed and wire the Favorites tab to read from it.

- **KUBO-061: Kid view — add Blobby section to navbar (Home · Blobby · Favorites)**
  The kid navbar should have three sections. Currently missing a middle Blobby tab where the kid takes care of their own blobby (pet/companion). Order: Home · Blobby · Favorites. Scope: add the route + nav entry + a stub page; the actual Blobby care mechanics are a separate design task.

- **KUBO-062: Parent view — kid selector pill avatar not wired to real profile picture**
  The kid selector pill in the top-right of the parent view has a placeholder circle for the selected kid's profile picture, but it isn't reading the actual picture from the kid's kind:0 metadata. Wire it to the selected kid's profile picture (via the existing profile/metadata hook used elsewhere in the app), with a sensible fallback when the kid has no picture set yet.

- **KUBO-063: Kid feed — "Next post" button as alternative to infinite scroll**
  Add an explicit "Next post" button on the kid feed so the kid advances one post at a time with an intentional tap, rather than endlessly scrolling. Goal is to remove the infinite-scroll loop from the kid experience (attention/time-on-app concern). Design decision: does the button replace scrolling entirely (one post at a time, full-screen), or coexist with a bounded scroll? Likely one-post-at-a-time fits the kid mode best. Wire it onto the existing feed query's pagination (advance cursor / index into the fetched pages, fetch next page when approaching the end).

## Deferred to post-MVP

- **KUBO-002: Separate devices** — parent and kid on distinct devices rather than sharing one; requires some transport between them (pairing, key sync, etc.).
- **KUBO-003: Parent keypair usage** — first-class parent identity with its own nsec (not just a signer-for-kid). Needed for guardian-list events, co-signing, parent-to-parent trust.
- **KUBO-004: Guardian list kind** — custom Nostr kind listing authorized guardians for a kid account. Schema design + NIP-style doc.
- **KUBO-005: Co-signing / recovery** — multi-guardian threshold signing on sensitive actions (key rotation, account recovery, trust-domain edits).
- **KUBO-006: QR handoff** — secure pairing between parent and kid device via QR (initial setup, device swap, guardian addition).
