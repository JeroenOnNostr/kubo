# Kubo — TODO

Issue prefix: `KUBO-xxx`

## Open

- **KUBO-102: Wire trust assignments to actual feed routing** *(replaces the now-removed KUBO-013)*
  KUBO-100 introduced `relayTrustAssignments[kid][relayUrl]` and KUBO-097/098/100 cleaned up `trustAssignments[kid][pubkey]`, but both maps are visual-only — they don't yet influence which content the kid sees. Decide the routing model: should `extend` mean "merge this relay's contents into the kid's feed", `interact` allow replies/zaps, `view` gate appearance in the People tab? And do we mirror that to NIP-65 `r`-tags + a kid-scoped `kind:30078` for relays so the assignments survive cross-device login? Once the model is fixed, wire `useFeedSources` / `useKidFeedRelays` to read from these maps instead of the existing per-source toggles, and define what happens to a relay or pubkey that's enabled in a feed-source page but unassigned in trust (and vice versa).

- **KUBO-001: Upload flow — parent posts, signed by kid's key**
  Upload UX lives in the parent app, but the resulting event is signed with the kid's private key (the parent is acting on behalf of the kid, not posting from their own identity). Relevant to PR 4 (Upload). Figure out key-access model: does the parent hold the kid's nsec, unlock it per-upload, or sign via a delegation/NIP-46-style handoff?

- **KUBO-011: App-wide biometric / device-PIN gate for nsec reveal and export**
  Neither Kubo nor upstream Ditto currently gates nsec reveal behind any authentication — the Eye toggle in `KidKeysPage`, `ProfileSettings.BackupKeySection`, and `InitialSyncGate` is a plain `useState`. Install a Capacitor biometric plugin (e.g. `@capacitor-community/biometric-auth`) with a web fallback (AlertDialog "type NSEC to confirm"), and wrap the reveal/export paths with a shared `<RequireAuth>` helper so the gate covers both parent and kid nsec surfaces.

- **KUBO-016: Signer-swap render-loop crash on `/parent/kid/:id/feed-settings`**
  Pre-existing bug: after `setLogin(kidLoginId)` fires in `useEditAsKid`, the target page throws *Maximum update depth exceeded* in a Radix `<Switch>` (`setRef` inside an `Array.map` in `dist-D0IwgzoO.js`) and the ErrorBoundary takes over. `/settings/network` with the same `<RelayListManager />` + `<BlossomSettings />` under a stable login renders fine, so the trigger is the account-switch cascade, not those components. Likely culprit: one of the `updateConfig`-in-effect blocks in `NostrSync.tsx` (relayMetadata sync, Blossom sync, or encrypted-settings sync — all depend on `user?.pubkey` and call `updateConfig(...)` on every run) fires repeatedly when the kid's `kind:10002`/`30078` events haven't been seeded into the query cache yet, feeding back into itself via `config.*.updatedAt` deps. Repro: `python3 /tmp/kubo-trust-places-verify.py` against `npm run dev`. Fix direction: make the NostrSync effects idempotent against "event not yet fetched" state (skip `updateConfig` if the fetched event is older than `updatedAt`, or gate on `isFetched` rather than presence of data).

- **KUBO-021: Videos tab — trust-scoped filtering**
  Follow-up to KUBO-020. `VideosTab` on `/parent/profile/:npub` currently shows every media event from the creator, unfiltered. Once KUBO-102 defines the trust → feed-routing mapping, filter `useProfileMedia` results by the current kid's trusted-authors set (or the kid's active trust level) so the grid matches what the kid is allowed to see. Probably a thin wrapper hook `useKidScopedProfileMedia(pubkey, kidId)` that post-filters the infinite query pages.

- **KUBO-022: Videos tab — infinite scroll**
  Follow-up to KUBO-020. `VideosTab` only renders the first `useProfileMedia` page (~20 events). Wire an IntersectionObserver sentinel at the bottom of the grid that calls `fetchNextPage()` when visible, using the hook's already-implemented `getNextPageParam`.

- **KUBO-028: Real video categorization model**
  Category chips (All / Animals / Music / Craft / Stories) were removed in KUBO-026 because NIP-71 video events rarely carry `#t` topic tags, making non-"All" selections return empty feeds. Reintroduce once there's a backing data model: our own addressable event, a NIP-50 search query per category, an ML-based classifier running on thumbnails/titles, or an adopted `#t` convention. Until then, the chips were misleading UI.

- **KUBO-036: Merge upstream Ditto v2.10.3 into `brand/main`**
  Upstream Ditto has 7 commits on `main` that aren't in `brand/main` yet: lightbox swipe-to-dismiss flicker fix, release 2.10.3, iOS status-bar text color fix on light theme, envelope-card mobile tap fixes, swipe-to-dismiss on lightbox overlays, wall compose-box clearing, autoplay-videos setting. Local `main` has already been fast-forwarded to `upstream/main`; follow the flow in memory note [kubo.md](../../.claude/projects/-home-jeroen-VScode-workspace-for-building-nostr-apps/memory/kubo.md): `git checkout brand/main && git merge main`, resolve any brand-specific conflicts, `git push origin brand/main`. Watch for conflicts on files Kubo has rebranded/customized.

- **KUBO-037: Set up Android release-signing keystore**
  v0.1.0 and v0.1.1 APKs are debug-signed (shared dev key across all developers' machines) — fine for personal testing but blocks Play Store distribution, means users can't cleanly update to a release-signed build later, and gives no signing-identity guarantee. Run `npm run keygen` to generate an upload keystore, fill in `android/key.properties` with the alias/passwords, and the existing `signingConfigs.release` block in `android/app/build.gradle` will pick it up. Store the keystore + passwords somewhere durable (losing them means losing the ability to update the app). Only unblock once we're ready to distribute beyond Jeroen's own device.

- **KUBO-057: Select communities page — improve search reliability**
  On `/parent/feed/communities` (`CommunitiesSourcePage.tsx`) the search pill returns inconsistent results for kind-34550 community queries. Audit the NIP-50 query, relay set, and result dedupe.

- **KUBO-063: Trust → People — wire up Groups section to real group functionality**
  `TrustPeoplePage` renders a hardcoded `GROUPS` array with two placeholder entries ("Soccer team B3", "Elementary class 4B") that link to placeholder routes under `/parent/groups/:id`. Use case: parents form a group with other parents, or set up a group around the kid's context (sports team, school class) so members can DM each other or share media scoped to the group. Decide the data model first — likely NIP-29 relay-based groups or NIP-51 kind:30000 follow sets — then wire create/join, member list, and group detail page. Likely worth splitting into separate issues once scoped: (a) group data model + create/join flow, (b) group detail screen replacing `/parent/groups/:id` placeholder, (c) group DM thread, (d) group media upload/share. Capture sub-issues as KUBO-063a/b/c/d when ready.

## Completed

- **KUBO-053: Parent feed view — remove descriptions on "Edit feed settings" and "Feed preview" tiles**
- **KUBO-054: Parent home — merge "Today's usage" bar into the Kids activity chart**
- **KUBO-061: Kid view — add Blobby section to navbar (Home · Blobby · Favorites)**
- **KUBO-062: Parent view — kid selector pill avatar not wired to real profile picture**
- **KUBO-085: Kid-themed profile viewer (`/kid/profile/:npub`)**
- **KUBO-086: Kid-themed post detail (`/kid/post/:id`) + `KidNavigationInterceptor`**
- **KUBO-088: Fix kid lock-screen stuck on fresh load (screen-time tracker race)**
- **KUBO-097: Unify "Assign trust" UX — replace profile bottom-sheet with inline expand**
- **KUBO-096: Strip App Relays UI from RelayListManager**
- **KUBO-098: Kid "Request to interact" → parent Alerts inbox**
- **KUBO-099: NIP-66 relay discovery + collapsible Browse-all + search hide flags**
- **KUBO-100: Trust → Places trust-relay rows + Trust → People assignment-driven list**
- **KUBO-101: Record kind-34236 vine plays into kid watch history (naddr-aware)**
- **KUBO-087: Kid post detail — YouTube videos play inline** *(closed: already fixed in `6c1ee671` as part of KUBO-085/086; entry was stale paperwork)*
- **KUBO-025: Wire Kids watch history + Kids activity placeholders to real data** *(KUBO-095 + KUBO-101)*
- **KUBO-060: Kid view — Favorites add-to-favorites affordance** *(landed via FavoriteStarButton overlay; see KUBO-072 / KUBO-076)*
- **KUBO-059: Parent feed profiles — expandable tiles + avatar nav** *(closed: deferred — equivalent UX now lives on Trust → People per KUBO-100)*
- **KUBO-009: Handle returning-user-on-new-device case in onboarding** *(closed: cross-device returning-user flow is post-MVP; the silent default-write only happens during onboarding and the user is comfortable with that exposure for now)*

## Deferred to post-MVP

- **KUBO-002: Separate devices** — parent and kid on distinct devices rather than sharing one; requires some transport between them (pairing, key sync, etc.).
- **KUBO-003: Parent keypair usage** — first-class parent identity with its own nsec (not just a signer-for-kid). Needed for guardian-list events, co-signing, parent-to-parent trust.
- **KUBO-004: Guardian list kind** — custom Nostr kind listing authorized guardians for a kid account. Schema design + NIP-style doc.
- **KUBO-005: Co-signing / recovery** — multi-guardian threshold signing on sensitive actions (key rotation, account recovery, trust-domain edits).
- **KUBO-006: QR handoff** — secure pairing between parent and kid device via QR (initial setup, device swap, guardian addition).
