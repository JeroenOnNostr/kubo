# Kubo — DONE

Issue prefix: `KUBO-xxx`

## Completed

- **KUBO-024: Persistent kid selector in parent chrome**
  Extracted the per-page gear dropdown on `/parent/feed` into a shared `KuboKidSelector` (pill: avatar + displayName + chevron-down) and mounted it in `KuboParentLayout`'s new slim top header alongside the wordmark, so every `/parent/*` route now shows which kid the parent is configuring and lets them swap. Selector reuses the existing "Switch to kid view" / "Switch to parent view" / "Add a kid…" menu verbatim; reads the active kid via `useSelectedKid`, drives it via `setLogin` from `useNostrLogin`. `ParentFeedPage.tsx`'s superseded header-cleanup was subsumed by concurrent KUBO-023 WIP and is not part of this commit. Commit: b1830af6 · 2026-04-21

- **KUBO-023: Wire kid home + parent feed preview to NIP-71 follows feed**
  Replaced the hardcoded hero card on `/kid` and the hardcoded `VIDEOS` array on `/parent/feed` with a real Nostr query over the active signer's follow list. Extracted `parseVideoImeta` + `fmtDuration` + `getTag` from `VideosFeedPage` into `lib/videoEvent.ts` for reuse. Kid tile tap → inline video playback (no navigation); standalone Play button removed. Trust dot removed from cards. Landed with regressions fixed in KUBO-026. Commit: {COMMIT_HASH} · 2026-04-21

- **KUBO-026: Fix mixed-kind kid feed (useKidFeed bypasses Ditto settings, no inline video thumbnails)**
  Follow-up to KUBO-023. Renamed `useKidVideoFeed` → `useKidFeed` and made it a pass-through to `useFeed('follows')`, restoring the Edit Feed Settings kind toggles (was previously hardcoded to kinds 21/22). Rewrote `KidFeedList` to render every event through Ditto's universal `NoteCard` — kind 21/22 get inline `VideoPlayer` playback (no navigation), other kinds get their standard Ditto cards. Deleted `VideoFeedCard.tsx`. Mirrored the dedupe+mute+hide pipeline from `Feed.tsx`. Removed category chips from both pages (see KUBO-028). Also removed the dev-only state switcher pill on `/kid` that was leaking into non-DEV builds. Commit: {COMMIT_HASH} · 2026-04-21
