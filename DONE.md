# Kubo — DONE

Issue prefix: `KUBO-xxx`

Completed work, most recent first.

## 2026-04-21

- **KUBO-034: Respect Android safe-area top inset in Kubo layouts** — `51605f2b`
  Added the existing `safe-area-top` utility to `KuboParentLayout` and `KuboKidLayout` so content no longer collides with the Android notch/status bar on the Capacitor build. Harmonised `KuboOnboardLayout` to use the same `var(--safe-area-inset-top, env(...))` form as the rest of the codebase. Dropped the now-redundant manual `pt-12` on KidHomePage (Favorites + Envelopes) down to `pt-4`.

- **KUBO-033: Rebrand app icon to Kubo logo** — `109d8b40`
  Regenerated every launcher/app icon from `public/logo-color.svg`: Android mipmaps (hdpi/mdpi/xhdpi/xxhdpi/xxxhdpi × launcher/round/foreground), iOS AppIcon-512@2x, PWA icon-192/icon-512/apple-touch-icon/favicon, and `public/logo.png`. `ic_launcher_background.xml` switched from Ditto purple `#7c52e0` to white `#ffffff`; `manifest.webmanifest` name/short_name/description switched from Ditto → Kubo. Also rewrote the icon generator from bash+ImageMagick (`scripts/generate-icons.sh`) to a Node + `sharp` + `png-to-ico` script (`scripts/generate-icons.mjs`) so `npm run icons` works without system image tooling; added `sharp` and `png-to-ico` as devDependencies.

- **KUBO-032: Kid profile picture upload flow** — `6eba593d`
  Parents can now set/update each kid's kind-0 `picture` without ever making the kid the active signer (sidesteps the KUBO-016 signer-swap render loop). AddKidPage accepts an optional avatar during creation; EditKidSettingsPage header offers Upload/Change with inline crop. New `src/lib/kidProfile.ts` (`publishKidProfileUpdate` — fetches latest kind 0 from relays before merging, preserves `published_at` per NIP-24, signs via `NLogin.fromNsec` + `NUser.fromNsecLogin`), new `useUploadKidAvatar` / `usePublishKidProfile` hooks accepting either `{ kidPubkey }` (reads nsec from Nostrify login store) or explicit `{ nsec }` (for the AddKid handler where `login.nsec(...)` was just called). Extracted `uploadFileWithSigner` out of `useUploadFile` so the kid hook reuses the same Blossom + BUD-04 mirroring path. New shared `KidAvatar` read-side component (uses `useAuthor`, no signer swap) rendered in KidDashboardPage, KidKeysPage, and the ParentFeedPage kid picker. AddKid upload is non-blocking — a failed upload still leaves a cleanly created kid.

- **KUBO-031: Fix banner covering profile picture on profile view** — `84c37202`
  Banner wrapper has `position: relative`, sibling avatar+name wrapper was static. Positioned siblings paint above static siblings regardless of DOM order, so the banner covered the avatar despite the `-mt-10` overlap. Added `relative` to the avatar container so both share the same stacking context and DOM order wins — matches Ditto's `ProfilePage` pattern. One-word fix on [src/pages/ProfileViewPage.tsx:71](src/pages/ProfileViewPage.tsx#L71).

- **KUBO-030: Rebrand Android shell to Kubo** — `a2020d2e` (merged as `b937160c`)
  `applicationId` / launcher label / Capacitor `appId` / `appName` switched from `pub.ditto.app` / Ditto to `com.kubo.app` / Kubo. `versionName` reset to `0.1.0` — fresh Kubo lineage, not a continuation of Ditto's 2.10.2. Kept `namespace = pub.ditto.app` so the five native Java sources under `android/app/src/main/java/pub/ditto/app/` compile unchanged (invisible to users). Built a debug APK and shipped it as GitHub release [`kubo-v0.1.0`](https://github.com/JeroenOnNostr/kubo/releases/tag/kubo-v0.1.0) with `kubo-v0.1.0-debug.apk` attached. Follow-ups deferred: Kubo launcher icon, Java-package move to `com.kubo.app`, real release-signing keystore, `ditto.pub` deep-link filter cleanup.

- **KUBO-029: Wire Trust domain → People to kid's follow list + persist trust assignments** — `e239ac0a`
  Replaced the hardcoded `INNER_CIRCLE` / `OTHER` arrays on `/parent/trust/people` with real data from the active kid's kind-3 follow list. Partitions by local trust assignment: `extend` → INNER CIRCLE (alphabetical), everything else → OTHER (interact → view → unassigned, alphabetical within each). GROUPS stays hardcoded. Tapping a row expands inline to an Extend / Interact / View / Remove action bar; writes land in a new `trustAssignments` map on `KuboFamily` in secureStorage — no Nostr event yet (KUBO-013 will define the kind). Also wires `AssignTrustLevelButton` on `/parent/profile/:npub` through the same store. Refactored `useKuboFamily` from per-caller `useState` to a module-level singleton + `useSyncExternalStore` (matching `item-cooldown.ts`) so writes propagate to every subscriber in one render pass — without this, bar-writes weren't visible to the page. `TrustFollowRow` is `React.memo`'d and calls `useAuthor` per-row (Ditto `FollowingUserRow` pattern) for cache-first rendering.

- **KUBO-026: Fix mixed-kind kid feed (useKidFeed bypasses Ditto settings, no inline video thumbnails)** — `e5a92e80`
  Follow-up to KUBO-023. Renamed `useKidVideoFeed` → `useKidFeed` and made it a pass-through to `useFeed('follows')`, restoring the Edit Feed Settings kind toggles (was previously hardcoded to kinds 21/22). Rewrote `KidFeedList` to render every event through Ditto's universal `NoteCard` — kind 21/22 get inline `VideoPlayer` playback (no navigation), other kinds get their standard Ditto cards. Deleted `VideoFeedCard.tsx`. Mirrored the dedupe+mute+hide pipeline from `Feed.tsx`. Removed category chips from both pages (see KUBO-028). Also removed the dev-only state switcher pill on `/kid` that was leaking into non-DEV builds.

- **KUBO-024: Persistent kid selector in parent chrome** — `b1830af6`
  Extracted the per-page gear dropdown on `/parent/feed` into a shared `KuboKidSelector` (pill: avatar + displayName + chevron-down) and mounted it in `KuboParentLayout`'s new slim top header alongside the wordmark, so every `/parent/*` route now shows which kid the parent is configuring and lets them swap. Selector reuses the existing "Switch to kid view" / "Switch to parent view" / "Add a kid…" menu verbatim; reads the active kid via `useSelectedKid`, drives it via `setLogin` from `useNostrLogin`. `ParentFeedPage.tsx`'s superseded header-cleanup was subsumed by concurrent KUBO-023 WIP and is not part of this commit.

- **KUBO-023: Wire kid home + parent feed preview to NIP-71 follows feed** — `e5a92e80`
  Replaced the hardcoded hero card on `/kid` and the hardcoded `VIDEOS` array on `/parent/feed` with a real Nostr query over the active signer's follow list. Extracted `parseVideoImeta` + `fmtDuration` + `getTag` from `VideosFeedPage` into `lib/videoEvent.ts` for reuse. Kid tile tap → inline video playback (no navigation); standalone Play button removed. Trust dot removed from cards. Landed with regressions fixed in KUBO-026.

- **KUBO-020: Wire /parent/profile/:npub to real Nostr data** — `0fb21591`
  First landed on `feat/kubo-020-profile-view-wiring`; merged into `brand/main` 2026-04-21. Replaced placeholder profile-view scaffolding with real Nostr queries. Underpins the trust-assignment work in KUBO-029 on the same profile page.

- **KUBO-010: Backup keys page — parent-side retrieval of the logged-in kid's npub/nsec** — `a41daaa9`
  New `KidKeysPage` at [src/pages/KidKeysPage.tsx](src/pages/KidKeysPage.tsx), routed as `/parent/keys`. Shows the logged-in kid's npub (always visible, safe to share) and nsec (masked, Eye reveal + amber warning, Copy button, "Back Up Key" via `saveNsec`). Reads from `logins[0]`, mirroring the `BackupKeySection` pattern in `ProfileSettings.tsx`. Retroactively logged 2026-04-21.

## 2026-04-20

- **KUBO-007: Single-device MVP onboarding — 3 screens, no QR** — `dc8265e3`
  Shipped the 3-screen onboarding flow for single-device MVP: `/onboard/welcome` → `/onboard/create-parent` → `/onboard/add-kid`. No QR screen, no multi-device handoff. New `KuboOnboardLayout` with a 3-dot progress indicator ([src/components/KuboOnboardLayout.tsx](src/components/KuboOnboardLayout.tsx)), plus `WelcomePage`, `CreateParentAccountPage`, and `AddKidPage`. `KuboBootGate` routes unauthenticated visitors to `/onboard/welcome`. Retroactively logged 2026-04-21.
