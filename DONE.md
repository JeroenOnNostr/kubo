# Kubo — DONE

Issue prefix: `KUBO-xxx`

## Completed

- **KUBO-024: Persistent kid selector in parent chrome**
  Extracted the per-page gear dropdown on `/parent/feed` into a shared `KuboKidSelector` (pill: avatar + displayName + chevron-down) and mounted it in `KuboParentLayout`'s new slim top header alongside the wordmark, so every `/parent/*` route now shows which kid the parent is configuring and lets them swap. Selector reuses the existing "Switch to kid view" / "Switch to parent view" / "Add a kid…" menu verbatim; reads the active kid via `useSelectedKid`, drives it via `setLogin` from `useNostrLogin`. `ParentFeedPage.tsx`'s superseded header-cleanup was subsumed by concurrent KUBO-023 WIP and is not part of this commit. Commit: {COMMIT_HASH} · 2026-04-21
