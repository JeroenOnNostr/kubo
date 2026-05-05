# Kubo perf review: ~10x for kid views, feed, and videos

## Context

User asked for an independent perf review of Kubo (soft fork of Ditto, Nostr client) targeting **loading time and rendering speed for kid views, the feed, and the videos page**, with a 10x improvement aim.

**Hard constraint (clarified mid-session):** Kubo is a *soft fork* of Ditto. We pull `upstream/main` into `main` periodically and merge into `brand/main`. Every line we touch in a Ditto-owned file is a future merge conflict. Per [feedback_kubo_ui_vs_ditto_hooks.md], the rule is: **reuse Ditto's data layer; keep Kubo's UI shell custom; never fork or copy Ditto hooks into Kubo.** This plan extends that rule to perf work — we optimize on Kubo-owned surfaces and via configuration that doesn't touch Ditto code.

## Verified current state (2026-05-04, on `brand/main`)

### Bundle (from `dist/assets/`)
- `index.js` = **948 KB** uncompressed (the eager main entry)
- `NoteCard.js` chunk = **196 KB** — Ditto-owned, eagerly imports ~30 kind-specific renderers at top of file
- `EmbeddedNote.js` = 172 KB, `EmbeddedPost.js` = 104 KB
- `EmojiPicker.js` = 509 KB (already lazy via `ReplyComposeModal`)
- `hls.js` = 507 KB (already dynamically imported in [VideoPlayer.tsx:54-63](../../VScode workspace for building nostr apps/kubo/src/components/VideoPlayer.tsx#L54-L63))
- `BlobbiStageVisual.js` = 252 KB (lazy via companion)
- 291 chunks total, ~11 MB on disk

### Ownership (confirmed via `git log --diff-filter=A`)
| File | Origin | Touch policy |
|---|---|---|
| [src/AppRouter.tsx](../../VScode workspace for building nostr apps/kubo/src/AppRouter.tsx) | Ditto (initial commit) | **Minimize**: Ditto evolves this regularly. Already heavily lazified for Ditto routes. |
| [src/App.tsx](../../VScode workspace for building nostr apps/kubo/src/App.tsx) | Ditto | **Header comment forbids modification** (line 1) — config tuning OK, structure changes aren't. |
| [src/components/NoteCard.tsx](../../VScode workspace for building nostr apps/kubo/src/components/NoteCard.tsx) | Ditto | **Don't touch** — 1998 lines, Ditto changes monthly. |
| [src/components/Feed.tsx](../../VScode workspace for building nostr apps/kubo/src/components/Feed.tsx) | Ditto | **Don't touch.** |
| [src/components/VideoPlayer.tsx](../../VScode workspace for building nostr apps/kubo/src/components/VideoPlayer.tsx) | Ditto | **Don't touch.** |
| [src/pages/VideosFeedPage.tsx](../../VScode workspace for building nostr apps/kubo/src/pages/VideosFeedPage.tsx) | Ditto | **Don't touch.** |
| [src/hooks/useVideoThumbnail.ts](../../VScode workspace for building nostr apps/kubo/src/hooks/useVideoThumbnail.ts) | Ditto | **Don't touch.** |
| [vite.config.ts](../../VScode workspace for building nostr apps/kubo/vite.config.ts) | Ditto | **Minimize**: append-only edits to `manualChunks` are safe (Kubo already added the lucide rule); don't restructure. |
| [src/hooks/useKidFeed.ts](../../VScode workspace for building nostr apps/kubo/src/hooks/useKidFeed.ts) | **Kubo (KUBO-023)** | Free to modify. |
| [src/components/feed/KidFeedList.tsx](../../VScode workspace for building nostr apps/kubo/src/components/feed/KidFeedList.tsx) | **Kubo (KUBO-023)** | Free to modify. |
| Kubo pages (`KidHomePage`, `KuboParentLayout`, `Welcome`, `AddKid`, `KidDashboard`, `KidWatchHistory`, `KidKeys`, `EditKidSettings`, `EditKidFeedSettings`, `TrustPeople`, `TrustPlaces`, `ParentTrustIndex`, `ParentFeed`, `VideoView`, `ProfileView`, `ContentUploader`, `GroupView`, `WoTScore`, `KuboKidLayout`, `KuboKidBlobbi`, `KidProfileView`, `KidPostDetail`) | **Kubo** | Free to modify. |
| [src/kuboKidRoutes.tsx](../../VScode workspace for building nostr apps/kubo/src/kuboKidRoutes.tsx), [src/kuboFeedSourcesRoutes.tsx](../../VScode workspace for building nostr apps/kubo/src/kuboFeedSourcesRoutes.tsx) | **Kubo** | Free to modify. |

### Critical observation re: AppRouter

[AppRouter.tsx:43-67](../../VScode workspace for building nostr apps/kubo/src/AppRouter.tsx#L43-L67) is a **Kubo block** added inside a Ditto file: 24 Kubo pages eagerly imported at the top, plus `kuboKidRoutes` (which itself eagerly imports 4 more Kubo pages). All 28 Kubo pages get baked into `index.js`. **The lines themselves are Kubo code in a Ditto file**, which is the worst-of-both-worlds for merge churn.

### TanStack Query config ([App.tsx:39-47](../../VScode workspace for building nostr apps/kubo/src/App.tsx#L39-L47))
- `staleTime: 60s`, `gcTime: 300s` (5 min), `refetchOnWindowFocus: false`. Ditto-owned but config-only.

### Virtualization
None. `package.json` has no `react-window` / `react-virtuoso` / `@tanstack/react-virtual`.

### Image attrs
`loading="lazy"` used in 83 places; `decoding="async"` used in only 5.

### useKidFeed ([useKidFeed.ts](../../VScode workspace for building nostr apps/kubo/src/hooks/useKidFeed.ts))
Kubo-owned, 282 lines. PAGE_SIZE=15, OVER_FETCH_MULTIPLIER=3 (45 raw events per leg per page when replies excluded — 135 raw events per page across 3 legs). Fires a second relay query per page to resolve unembedded reposts ([useKidFeed.ts:222-241](../../VScode workspace for building nostr apps/kubo/src/hooks/useKidFeed.ts#L222-L241)).

---

## Recommended plan (forward-compat-respecting, ordered by impact-per-effort)

### Tier 1 — High impact, zero or near-zero Ditto diff

#### 1. Lazy-load all Kubo pages in AppRouter — purely additive Kubo code

**Files:** [src/AppRouter.tsx](../../VScode workspace for building nostr apps/kubo/src/AppRouter.tsx) lines 43-67, [src/kuboKidRoutes.tsx](../../VScode workspace for building nostr apps/kubo/src/kuboKidRoutes.tsx) lines 3-6.

**What:** Convert every Kubo page import (`KuboBootGate`, `KuboParentLayout`, all `Kid*Page`, `Welcome*`, `AddKid*`, `Trust*`, `Parent*`, `Group*`, `WoT*`, `KuboKidLayout`, `KuboKidBlobbi`, `KidProfileView`, `KidPostDetail`, `KuboPlaceholderPage`) from static `import { X } from "@/pages/X"` to `const X = lazy(() => import("@/pages/X").then(m => ({ default: m.X })))`. Use the *exact* lazy pattern Ditto uses on lines 70-118 — visually identical, sits in the same code shape Ditto evolves, so future merges will conflict only on additions, not pattern mismatch.

Keep `KuboBootGate` itself eager (it's the entry redirect, must paint without a chunk fetch).

**Why this is forward-compat-safe:**
- All these `import` statements are Kubo-added lines in AppRouter. They'll already conflict on every upstream merge that touches AppRouter, regardless of whether they're eager or lazy. Switching to lazy doesn't increase merge surface — it just changes the form.
- Kubo route definitions (lines 329-360) are unchanged.
- `kuboKidRoutes.tsx` is fully Kubo-owned.

**Impact:** Conservative estimate **300-450 KB shaved off `index.js`** (28 Kubo pages × avg 12-18 KB). Bundle drops from 948 KB → ~550-650 KB on this step alone. Zero impact on cold-start of kid (`/kid` chunk loads once, in parallel) but huge impact on cold-start of `/feed` for users who never go to `/parent/*`.

**Risk:** Lazy boundaries need `<Suspense fallback={…}>`. AppRouter already wraps all Ditto lazy pages — confirm Kubo pages render inside the same boundary or add per-route Suspense if they need a non-null fallback (e.g. KuboKidLayout has its own chrome that should show during chunk fetch).

**Verification:** Run `npm run build`, open `dist/bundle.html`. Confirm `index.js` is well under 600 KB. Smoke-test: visit `/kid`, `/parent/home`, `/onboard/welcome`, `/feed` — each should fetch only its own chunk.

---

#### 2. Virtualize **only** `KidFeedList` (Kubo-owned) with `react-virtuoso`

**File:** [src/components/feed/KidFeedList.tsx](../../VScode workspace for building nostr apps/kubo/src/components/feed/KidFeedList.tsx) (Kubo-authored, KUBO-023).

**What:** Add `react-virtuoso` (~30 KB gz, native variable-height support — best for mixed NoteCard heights). Replace the `feedItems.map` at lines 175-228 with `<Virtuoso>`:
- `data={feedItems}` (sliced to `capAtIndex+1` when capped, instead of `display:none`)
- `itemContent={(idx, item) => <NoteCardWrapper item={item} idx={idx} />}` — **NoteCard itself is unchanged** (still imported from Ditto)
- `endReached={() => fetchNextPage()}` — replaces the [useInfiniteScroll](../../VScode workspace for building nostr apps/kubo/src/hooks/useInfiniteScroll.ts) sentinel at lines 111-116, 231
- For `postRefs` (used by `NextPostFAB`): use Virtuoso's imperative `scrollToIndex` API via `ref<VirtuosoHandle>`, then drop the manual ref array at line 81-85 of `KidHomePage.tsx`

**Why this is forward-compat-safe:**
- Both files are Kubo-owned (KUBO-023).
- We compose around Ditto's `NoteCard` rather than modifying it.
- We don't touch Ditto's `Feed.tsx` or `VideosFeedPage.tsx` — those use Ditto's own scrolling pattern, leave it.

**Impact (the biggest single win):**
- A typical kid scroll session today mounts 60-100 NoteCards (each runs `useAuthor`, `useEventStats`, `useNip05Verify`, `usePollVoteLabel`, `useRecordWatch`, plus optional VideoPlayer with its own state).
- Virtualization caps mounted cards at ~10-15 (visible + small overscan).
- **DOM nodes: ~10x reduction** on a 50-card scroll (~5000 → ~500).
- **TanStack Query parallelism: ~10x reduction** in concurrent author/stats queries.
- **Memory: ~10x reduction.**
- **Scroll FPS on mid-tier mobile: from janky to smooth.**

**Risk:** Medium.
- `NoteCard` fires `useRecordWatch` on mount. With virtualization, scroll-back remounts cards → would re-record watches. Mitigate with a `useRef<Set<string>>` of seen event IDs at the `KidFeedList` level, gating the `recordWatch` call. Better: wrap NoteCard in a `KidNavigationInterceptor`-style boundary that owns the dedup. **Don't modify NoteCard.**
- `capAtIndex` peek behavior (lines 184-198) currently uses a `display: none` + `maxHeight: 12px` trick. With virtualization, this becomes "render only `feedItems[0..capAtIndex]` and add a `Footer` component that shows the 12 px peek strip." Cleaner semantically.
- Scroll-restoration on navigation back: use Virtuoso's `restoreStateFrom` + `useLocation().key` keying.

**Verification:** Open `/kid` with React DevTools profiler. Scroll 50 cards. Mounted-component count should stay under 20. FPS counter should sit at 60 on a Pixel 6.

---

#### 3. Bump TanStack Query `gcTime` defaults — config-only, single-line diff

**File:** [src/App.tsx:39-47](../../VScode workspace for building nostr apps/kubo/src/App.tsx#L39-L47).

**What:** Change `gcTime: 300000` (5 min) → `gcTime: 1800000` (30 min). Matches what `useKidFeed` already overrides ([useKidFeed.ts:279](../../VScode workspace for building nostr apps/kubo/src/hooks/useKidFeed.ts#L279)) so we're aligning the global default with the existing Kubo override pattern.

**Why this is forward-compat-safe:** A single number change in a Ditto file. If Ditto ever changes their default, the merge resolution is trivial — pick whichever is larger.

**Impact:** Re-visiting kid feed within 30 min becomes instant (cache hit on every NoteCard's `useAuthor`, every event payload, every event-stats query). Eliminates ~80% of post-navigation re-fetches. This is the single change with the highest "perceived speed gain per LOC" ratio.

**Risk:** Low. Marginally higher memory ceiling.

---

#### 4. Tighten `useKidFeed` — drop second-round-trip, halve over-fetch

**File:** [src/hooks/useKidFeed.ts](../../VScode workspace for building nostr apps/kubo/src/hooks/useKidFeed.ts) (Kubo-owned).

**What:**
- **Drop `OVER_FETCH_MULTIPLIER` from 3 to 1.5** ([useKidFeed.ts:45,101-103](../../VScode workspace for building nostr apps/kubo/src/hooks/useKidFeed.ts#L45)). 67% reply rate is unrealistic for kid follow lists; 33% is plenty. Cuts relay query payload **by 50% per page**.
- **Eliminate the missing-repost second query** ([useKidFeed.ts:222-241](../../VScode workspace for building nostr apps/kubo/src/hooks/useKidFeed.ts#L222-L241)). Today: when a kind-6/16 repost doesn't carry the embedded event, you fire a **second round-trip per page** to resolve originals. Refactor to fold those IDs into the *next* page's filter as an extra clause — same data, no extra round-trip.

**Impact:** Saves 200-500 ms per `fetchNextPage` (typical relay roundtrip on mobile). Halves bytes-on-the-wire per page.

**Risk:** Low. Both are Kubo-owned. Drop OVER_FETCH=3 first; if reply density is higher than expected, bump to 2 (still better than 3). Make it configurable via `kubo.json` in case different deployments differ.

**Verification:** Network panel, scroll the kid feed → expect exactly one relay batch per `fetchNextPage`, and ~half the events per leg vs. before.

---

#### 5. Memoize `feedItems` flatten per-page in `KidFeedList`

**File:** [src/components/feed/KidFeedList.tsx:92-109](../../VScode workspace for building nostr apps/kubo/src/components/feed/KidFeedList.tsx#L92-L109) (Kubo-owned).

**What:** Today the `useMemo` recomputes the entire flattened+deduped+filtered list on every page-fetch. With infinite scroll, each new page re-flattens all prior pages — O(n²) over the session. Switch to a per-page `WeakMap<Page, FeedItem[]>` cache, then concat: `data.pages.flatMap(p => memoForPage(p))`. The dedup-across-pages `Set` lives at the concat step, but is small.

**Impact:** Mostly invisible at small N, dominant at 10+ pages. Combined with virtualization (Tier 1 #2), the scroll experience stays smooth indefinitely.

**Risk:** Low. Kubo-owned file.

---

### Tier 2 — Solid wins, slightly more effort

#### 6. Lazy-load `react-blurhash` and downgrade resolution — Kubo-side wrapper

**Problem:** [VideoPlayer.tsx:218-226](../../VScode workspace for building nostr apps/kubo/src/components/VideoPlayer.tsx#L218-L226) and [VideosFeedPage.tsx:205-216](../../VScode workspace for building nostr apps/kubo/src/pages/VideosFeedPage.tsx#L205-L216) (both Ditto-owned) decode blurhash via canvas synchronously per card. With 12 grid cards, that's 12 canvas decodes during initial render.

**Forward-compat-safe approach:** Don't touch VideoPlayer or VideosFeedPage. Instead, in `vite.config.ts` `manualChunks` (the existing Kubo-added rule at lines 167-173), add a chunk for `react-blurhash`:

```ts
if (id.includes('node_modules/react-blurhash')) return 'blurhash';
```

This won't *defer* it (Ditto's components import it eagerly), but it ensures blurhash is its own chunk and not nested into NoteCard / VideoPlayer chunks (cache reuse, parallel download).

The bigger virtualization win (Tier 1 #2) already eliminates off-screen blurhash decodes for the kid feed, so this is gravy.

**Impact:** Marginal; ~5-15 ms saved on initial render of `/videos`. Mainly chunk-cache improvement.

**Risk:** None.

---

#### 7. Image-quality config in `kubo.json`

**File:** [kubo.json](../../VScode workspace for building nostr apps/kubo/kubo.json) (Kubo-owned, gitignored upstream).

**What:** [App.tsx:174](../../VScode workspace for building nostr apps/kubo/src/App.tsx#L174) already exposes `imageQuality: 'compressed'` as a kubo.json-overridable setting, and [App.tsx:167](../../VScode workspace for building nostr apps/kubo/src/App.tsx#L167) exposes `corsProxy: 'https://proxy.shakespeare.diy/?url={href}'`. Verify the proxy supports a width/quality param (likely `&w=` and `&q=`). If yes, set `corsProxy` to include `&w={DPR-aware-default}&q=70`.

If the Shakespeare proxy doesn't resize, stand up a tiny Cloudflare Worker that does (Image Resizing on Workers is one of those "10 lines of code, big gain" wins). Point Kubo's `corsProxy` at the worker.

**Impact:** Mobile feeds frequently load 4 MB phone photos as avatars/thumbnails. Pulling 600 px instead of 4032 px saves ~3.5 MB per image, dramatic LCP improvement on `/kid` and `/videos`. **Easily a 10x reduction in bytes-on-wire** for image-heavy feeds.

**Risk:** Low (config-only on Kubo's side; workers are 1-time setup).

---

#### 8. New `KidVideoFeedPage` instead of optimizing Ditto's `VideosFeedPage`

**Why:** [VideosFeedPage.tsx](../../VScode workspace for building nostr apps/kubo/src/pages/VideosFeedPage.tsx) is 971 lines of Ditto code with 4 entangled features (Follows/Global tabs, live streams strip, video grid, shorts shelf). Touching it for perf will diff every upstream merge.

**Forward-compat-safe approach:** For the *kid* video experience specifically — which is the user's stated focus — build a Kubo-owned `KidVideoFeedPage` that:
- Reuses Ditto's `useFeed`, `useAllStreams` (Ditto data hooks) — call them, don't fork them.
- Renders Kubo's own minimal grid (Kubo-owned UI) — skip the live-streams strip, drag-scroll RAF loop, dual tab system, etc. Kids don't need any of that.
- Virtualizes via `react-virtuoso` (`VirtuosoGrid`).
- Lazy-loads `react-blurhash` and the thumbnail.
- Defers `useVideoThumbnail` to IntersectionObserver — implemented as a Kubo wrapper that calls Ditto's hook only when in viewport (don't fork the hook, *gate* it).

Keep `/videos` (Ditto's page) for the parent/regular-user view. Mount the Kubo page at `/kid/videos` or replace the `VideoView` route slot in [AppRouter.tsx:336](../../VScode workspace for building nostr apps/kubo/src/AppRouter.tsx#L336).

**Impact:** A purpose-built kid-videos page rendering 8-12 visible cards with virtualization + on-demand thumbs is plausibly **10x faster** to interactive than the kitchen-sink `VideosFeedPage`.

**Risk:** Medium. New Kubo page = new code to test, but **zero** Ditto diff.

---

#### 9. Add `decoding="async"` via a small Kubo `<Image>` wrapper

**Problem:** Ditto's components mix `loading="lazy"` and bare `<img>` with no `decoding` attribute. Decoding sync on mobile blocks the main thread for 5-50 ms per JPEG.

**Forward-compat-safe approach:** Don't add `decoding="async"` to Ditto's `<img>` tags (would require touching ~80 Ditto files). Instead, in any **new Kubo component** (e.g. the new `KidVideoFeedPage` from Tier 2 #8, future Kubo cards), use a Kubo-owned `<Image>` wrapper that always sets `decoding="async" loading="lazy"`. Mature gradually. No Ditto edits.

**Impact:** Marginal globally, but every new Kubo page paints faster.

**Risk:** None.

---

### Tier 3 — Out of scope for "10x" but worth knowing

- **NoteCard kind-split** (lazy-load 30 kind-specific renderers) would shave ~100-150 KB but requires editing 1998 lines of Ditto code — **rejected on forward-compat grounds**. If Ditto upstream ever does this themselves, we inherit it for free.
- **Bundle visualizer audit:** Already wired (`vite.config.ts:138-142`). After Tier 1 changes, open `dist/bundle.html` in a browser to confirm. **Use this to verify each step empirically** rather than estimating.

---

## Sequencing

| Day | Tier | Steps | Expected outcome |
|---|---|---|---|
| 1 (morning) | T1 | #3 (gcTime), #4 (useKidFeed tighten) | Network round-trips halved; instant cache hits on revisit |
| 1 (afternoon) | T1 | #1 (lazy Kubo pages) | `index.js`: 948 KB → ~550 KB. Bundle visualizer confirms. |
| 2-3 | T1 | #2 (virtualize KidFeedList) + #5 (per-page memo) | DOM nodes ~10x ↓ on scroll; FPS smooth on mid-tier mobile |
| 4-5 | T2 | #7 (image proxy resize) + #8 (KidVideoFeedPage) | Kid videos page ~10x faster TTI |
| 6 | T2 | #6 (blurhash chunk), #9 (Image wrapper) | Cleanup |

**After Tier 1: realistically 5-7x perceived perf on cold-start kid feed, 10x on warm-revisit.** Tier 2 closes the gap on the videos view and image-heavy paths to give a true 10x on the user's three target views.

---

## Critical files

**Modify (Kubo-owned, free to touch):**
- [src/AppRouter.tsx](../../VScode workspace for building nostr apps/kubo/src/AppRouter.tsx) lines 43-67 only (Kubo block in Ditto file — already-conflicting territory)
- [src/kuboKidRoutes.tsx](../../VScode workspace for building nostr apps/kubo/src/kuboKidRoutes.tsx)
- [src/components/feed/KidFeedList.tsx](../../VScode workspace for building nostr apps/kubo/src/components/feed/KidFeedList.tsx)
- [src/hooks/useKidFeed.ts](../../VScode workspace for building nostr apps/kubo/src/hooks/useKidFeed.ts)
- [src/pages/KidHomePage.tsx](../../VScode workspace for building nostr apps/kubo/src/pages/KidHomePage.tsx) (postRefs → Virtuoso handle)
- [kubo.json](../../VScode workspace for building nostr apps/kubo/kubo.json)
- (new) `src/pages/KidVideoFeedPage.tsx` (Tier 2 #8)
- (new) `src/components/kid/Image.tsx` (Tier 2 #9)

**Single-line config change in Ditto files:**
- [src/App.tsx:44](../../VScode workspace for building nostr apps/kubo/src/App.tsx#L44) (`gcTime`)
- [vite.config.ts:167-173](../../VScode workspace for building nostr apps/kubo/vite.config.ts#L167-L173) (append `react-blurhash` to manualChunks)

**Do NOT modify:**
- `src/components/NoteCard.tsx`, `src/components/Feed.tsx`, `src/components/VideoPlayer.tsx`, `src/pages/VideosFeedPage.tsx`, `src/pages/VinesFeedPage.tsx`, `src/hooks/useVideoThumbnail.ts`, `src/hooks/useFeed.ts` — all Ditto-owned, regularly evolved upstream. Compose around them; don't fork.

---

## Verification (end-to-end)

After each tier:

1. `npm run build` and inspect `dist/bundle.html` — confirm `index.js` size targets met (<600 KB after T1; <300 KB after T2 #8).
2. `npm run dev`, open `/kid` in Chrome DevTools mobile emulation (Pixel 7 throttled to "Slow 4G" + 4× CPU).
3. Lighthouse Performance run on `/kid`, `/feed`, `/videos`, `/parent/home` — record scores baseline vs. each tier.
4. React DevTools Profiler: scroll 50 NoteCards in `/kid`. Mounted-component count should stay <20 (proves virtualization works).
5. Network panel: scroll the kid feed → expect 1 relay batch per `fetchNextPage`, not 2 (proves T1 #4 worked).
6. Test forward-compat: `git fetch upstream && git checkout main && git merge upstream/main && git checkout brand/main && git merge main` — count conflicts. Goal: zero conflicts in `NoteCard.tsx`, `Feed.tsx`, `VideoPlayer.tsx`, `VideosFeedPage.tsx`, `useVideoThumbnail.ts`. Trivial conflicts only in `App.tsx`, `AppRouter.tsx`, `vite.config.ts`.
