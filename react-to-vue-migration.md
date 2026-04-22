# Kubo: React → Vue 3 (Composition API) Migration Plan

**Tracking ID:** KUBO-040
**Branch:** `feat/react-to-vue-migration`
**Status:** Proposal — not yet approved / not started
**Target framework:** **Vue 3.5+** (Composition API only, `<script setup>` SFCs, strict TypeScript)
**Author:** Claude (Opus 4.7) on behalf of Jeroen, 2026-04-22

---

## 0. TL;DR

Kubo is a soft-fork of Ditto, a ~181 kLOC React 18/19 SPA (459 `.tsx` + 406 `.ts` files) built on Vite + TanStack Query + shadcn/ui (Radix) + Tailwind + Nostrify + Capacitor. Migrating to **Vue 3 + Composition API** is a **multi-month, high-risk rewrite**, not a refactor. The 53 shadcn Radix primitives have no 1:1 Vue equivalent — every form, dialog, menu, and sheet must be re-picked from a Vue ecosystem library (**shadcn-vue / Radix Vue / Reka UI**). All 155 custom hooks must be rewritten as composables, the 212 TanStack Query call sites must be ported to `@tanstack/vue-query`, and the React 19 `<Suspense>` + `React.lazy` code-splitting has to be rebuilt with `defineAsyncComponent` + Vue Router lazy routes.

**The plan below proposes an incremental, branch-per-phase approach that keeps Kubo shippable at every step, rather than a big-bang rewrite.** If the user prefers, the alternative "fresh Vue repo, port page-by-page, retire React when parity reached" path is described in §10.

**Upstream implication:** Ditto (upstream) is React. A Vue fork means Kubo can no longer trivially pull upstream Ditto changes — every merge becomes a manual port. This is the single biggest strategic question; see §11 before committing.

---

## 1. Scope & current state

### 1.1 Stack inventory (what has to move)

| Layer | Current (React) | Target (Vue 3) | Effort |
|---|---|---|---|
| Framework runtime | React 19.2 + ReactDOM | Vue 3.5 (latest) | Mechanical per file, massive volume |
| Build tool | Vite 8 + `@vitejs/plugin-react` | Vite 8 + `@vitejs/plugin-vue` + `vite-plugin-vue-jsx` (only if needed) | Low |
| Routing | `react-router-dom` v6 | `vue-router` v4 | Medium |
| Data fetching | `@tanstack/react-query` v5 | `@tanstack/vue-query` v5 | Medium (API is ~1:1) |
| State (global) | React Context (×6) + zustand-style stores | `provide`/`inject` + Pinia | Medium |
| Forms | `react-hook-form` + `@hookform/resolvers` + zod | `vee-validate` + `@vee-validate/zod` (or VueUse + manual) | Medium |
| UI primitives | shadcn/ui on top of `@radix-ui/react-*` (~30 packages) | **shadcn-vue** on top of **Reka UI** (Radix Vue successor) | **High — biggest risk** |
| Icons | `lucide-react` | `lucide-vue-next` | Low (identical API) |
| Nostr plumbing | `@nostrify/react` (React-specific hooks) | Roll our own composables wrapping `@nostrify/nostrify` core | Medium |
| Login UX | `@nostrify/react/login` | Custom composable (`useNostrLogin()`) | Medium |
| Markdown editor | `@milkdown/react` | `@milkdown/vue` (same core packages) | Low |
| Head/SEO | `@unhead/react` | `@unhead/vue` (same package) | Low |
| Error tracking | `@sentry/react` | `@sentry/vue` | Low |
| Error boundaries | React `<ErrorBoundary>` class component | Vue `onErrorCaptured` + wrapper component | Low |
| Head/meta | `@unhead/react` | `@unhead/vue` | Low |
| Drag & drop | `@dnd-kit/core` (React) | `@vueuse/gesture` + `vue-draggable-plus` (or port) | Medium |
| Carousel | `embla-carousel-react` | `embla-carousel-vue` (official Vue binding) | Low |
| Charts | `recharts` (React) | `vue-chartjs` or `@unovis/vue` or `chart.js` | **Medium — no drop-in** |
| Resizable panels | `react-resizable-panels` | `vue-splitter-panel` / port | Medium |
| Day picker | `react-day-picker` | `v-calendar` or `@vuepic/vue-datepicker` | Medium |
| Day picker / calendar | `react-day-picker` | `v-calendar` | Medium |
| Crop | `react-easy-crop` | `vue-advanced-cropper` | Low |
| Toast | Radix toast + `sonner`-style wrapper | `vue-sonner` | Low |
| Vaul (drawer) | `vaul` | `vaul-vue` | Low |
| Command palette | `cmdk` | `vue-command-palette` / port | Medium |
| Intersection observer | `react-intersection-observer` | `@vueuse/core` `useIntersectionObserver` | Low |
| Markdown render | `react-markdown` + `rehype-sanitize` | `markdown-it` + `DOMPurify` | Low |
| Blurhash | `react-blurhash` | `vue-blurhash` (or port — 40 LOC) | Low |
| Capacitor | Platform-neutral — no change | Same | — |
| Tests | `@testing-library/react` + vitest + jsdom | `@vue/test-utils` + vitest + jsdom | Medium (only 6 test files today — low volume) |
| Android | Capacitor wraps the built SPA — no change | Same | — |

### 1.2 Raw metrics

- **181 372** lines of TS/TSX under `src/`
- **459** `.tsx` files (components + pages)
- **406** `.ts` files (hooks, lib, stores, types)
- **155** custom hooks under `src/hooks/`
- **137** files using TanStack Query hooks (**212** total call sites)
- **53** shadcn/ui primitives under `src/components/ui/`
- **76** pages under `src/pages/`
- **6** React Contexts under `src/contexts/` + `AppProvider`, `DMProvider`, `NostrProvider`, `AudioPlayerProvider`, `NWCProvider`, `BlobbiActionsProvider`
- **6** `.test.tsx` files (very thin test coverage — **migration cannot lean on tests to catch regressions**; see §8)
- **Very low** usage of React-specific escape hatches: only 3 `forwardRef`/`React.memo`/`useImperativeHandle` call sites in 2 files, which means the component model is ~95% idiomatic and should translate cleanly.

### 1.3 Features that make this hard

1. **shadcn/ui with heavy customization** — not vanilla Radix; many primitives in `src/components/ui/` are custom-extended. Each one needs a Vue twin that matches our visual + behavioural contract, not just the library swap.
2. **Route-level `React.lazy()` code-splitting** — already tuned for bundle size. We must preserve equivalent Vue chunk sizes or bundle regressions will hit mobile users first.
3. **`@nostrify/react` is React-specific** — we need to either (a) write a thin Vue composable layer over `@nostrify/nostrify` (the framework-agnostic core), or (b) get upstream Nostrify to publish a `@nostrify/vue` package (unlikely unless we contribute it).
4. **Capacitor native path** — the Android APK wraps the Vite `dist/` output. Vue builds the same way, so this should be a no-op — **but** the `scripts/patch-cap-config.mjs` and `capacitor.config.ts` need smoke-testing on device after the migration (status-bar theming logic in `main.tsx` must be ported 1:1 to `main.ts`).
5. **Milkdown editor** — has a first-party `@milkdown/vue` package, same crepe/plugins. Swap is supported.
6. **Blobbi subsystem** (`src/blobbi/`) — heavy animation, React-specific timing hooks, deeply integrated with the core feed. Probably the hardest single subsystem to port.
7. **kubo.json + DittoConfigSchema** — plain TS, zero React coupling. Zero migration effort.

---

## 2. Goals & non-goals

### 2.1 Goals

- **Functional parity** with current `brand/main` after migration: every page renders, every Nostr op works, the APK still builds and runs.
- **Composition API only.** No Options API anywhere. Strict TS. `<script setup lang="ts">` SFCs everywhere.
- **No bundle regressions** — gzip size within ±10% of current.
- **No UX regressions** — the visual design survives the library swap, down to animation timings where reasonable.
- **Upstream story** stays honest (see §11). We don't pretend we can still painlessly sync from `soapbox-pub/ditto`.

### 2.2 Non-goals

- **No feature work during the migration.** New features stop on `brand/main` while the port is in flight, or they ship twice (once React, once Vue). We'll freeze `brand/main` to bug-fixes only.
- **No redesign.** Pixel- and behaviour-parity. Design changes come after.
- **No test-suite expansion beyond what the port requires.** Kubo has 6 test files today; we're not going to blockade the migration behind writing a test suite first (though we'll add critical-path smoke tests — see §8).
- **No migration of the upstream Ditto React code we don't use** — if we don't render it, we don't port it.

---

## 3. Mapping: React concepts → Vue 3 Composition API

This is the dictionary every contributor will need. **All Vue examples use `<script setup>` + Composition API**; no Options API, no `defineComponent({ data() {} })`.

### 3.1 Component shape

```tsx
// React
export function MyButton({ label, onClick }: { label: string; onClick: () => void }) {
  const [count, setCount] = useState(0);
  return <button onClick={() => { setCount(count + 1); onClick(); }}>{label} ({count})</button>;
}
```

```vue
<!-- Vue 3 Composition API -->
<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{ label: string }>();
const emit = defineEmits<{ click: [] }>();

const count = ref(0);
function handle() {
  count.value++;
  emit('click');
}
</script>

<template>
  <button @click="handle">{{ props.label }} ({{ count }})</button>
</template>
```

### 3.2 Hook → composable

- `useState`              → `ref` / `reactive`
- `useEffect`             → `watchEffect` (reactive auto-tracking) or `watch` (explicit sources) or `onMounted`/`onUnmounted`
- `useMemo`               → `computed`
- `useCallback`           → plain function (Vue doesn't re-create handlers every render, so memoisation is rarely needed)
- `useRef` (for DOM)      → `ref<HTMLElement \| null>(null)` + `template ref`
- `useRef` (for mutable) → `shallowRef` or a plain object
- `useContext`            → `inject`
- `createContext`         → `provide`
- `useLayoutEffect`       → `onMounted` (with `flush: 'post'` if scheduling is needed)
- Custom hooks            → Composables (functions named `useXxx()` returning refs/computed/functions)

### 3.3 Routing

| React Router | Vue Router |
|---|---|
| `<BrowserRouter>` | `createRouter({ history: createWebHistory() })` |
| `<Routes>` + `<Route>` | `routes: [{ path, component }]` config |
| `<Navigate to="…" replace />` | `router.replace()` / `<router-link>` |
| `useNavigate()` | `useRouter()` → `.push()` / `.replace()` |
| `useParams()` | `useRoute().params` |
| `useLocation()` | `useRoute()` |
| `useSearchParams()` | `useRoute().query` + `router.replace({ query })` |
| Route-level `<Outlet />` | `<router-view>` |
| `React.lazy(() => import('./Page'))` | `component: () => import('./Page.vue')` (lazy by default) |

### 3.4 TanStack Query

API is ~1:1. `useQuery`, `useMutation`, `useInfiniteQuery`, `useQueryClient` all exist in `@tanstack/vue-query`. The single real difference is that **Vue Query returns refs** — so `data` is `Ref<T>` and must be unwrapped in templates (`{{ data }}`) or with `.value` in script.

```ts
// Before (React)
const { data, isLoading } = useQuery({ queryKey: ['feed'], queryFn: fetchFeed });

// After (Vue)
const { data, isLoading } = useQuery({ queryKey: ['feed'], queryFn: fetchFeed });
// In template: <div v-if="isLoading">…</div> <Feed :items="data" />
```

### 3.5 shadcn/ui → shadcn-vue

**shadcn-vue** ([shadcn-vue.com](https://www.shadcn-vue.com/)) mirrors shadcn/ui component APIs for Vue 3, built on **Reka UI** (the Vue port of Radix UI). This is the designated swap. Every file in `src/components/ui/` needs a Vue equivalent — we will **copy them from shadcn-vue**, not blindly port our customized React copies, then re-apply our Kubo-specific tweaks on top.

---

## 4. Dependency swaps — full list

```diff
- "react": "^19.2.4"
- "react-dom": "^19.2.4"
- "@types/react": "^19.2.14"
- "@types/react-dom": "^19.2.3"
- "@vitejs/plugin-react": "^6.0.1"
- "eslint-plugin-react-hooks"
- "eslint-plugin-react-refresh"
+ "vue": "^3.5.0"
+ "@vitejs/plugin-vue": "^5.2.0"
+ "@vue/tsconfig": "^0.7.0"
+ "vue-tsc": "^2.2.0"
+ "eslint-plugin-vue": "^9.x"

- "react-router-dom": "^6.26.2"
+ "vue-router": "^4.5.0"

- "@tanstack/react-query": "^5.56.2"
+ "@tanstack/vue-query": "^5.56.2"

- "@nostrify/react": "^0.5.1"
+ (no direct replacement — build `@/composables/useNostr*.ts` on `@nostrify/nostrify` core)

- "react-hook-form": "^7.71.1"
- "@hookform/resolvers": "^5.2.2"
+ "vee-validate": "^4.15.0"
+ "@vee-validate/zod": "^4.15.0"

- "@radix-ui/react-*" (30+ packages)
+ "reka-ui": "latest"  // the Vue successor to Radix Vue
+ (shadcn-vue components copied into src/components/ui/)

- "lucide-react": "^1.8.0"
+ "lucide-vue-next": "latest"

- "@milkdown/react": "^7.20.0"
+ "@milkdown/vue": "^7.20.0"

- "@unhead/react": "^2.1.13"
+ "@unhead/vue": "^2.1.13"

- "@sentry/react": "^10.42.0"
+ "@sentry/vue": "^10.42.0"

- "@dnd-kit/core" + "@dnd-kit/sortable" + "@dnd-kit/utilities"
+ "vue-draggable-plus" (+ "@vueuse/gesture" for custom cases)

- "embla-carousel-react": "^8.3.0"
+ "embla-carousel-vue": "^8.3.0"

- "react-day-picker": "^9.14.0"
+ "v-calendar": "^3.1.0"  OR  "@vuepic/vue-datepicker": "^9.0.0"

- "react-easy-crop": "^5.5.6"
+ "vue-advanced-cropper": "^2.8.0"

- "react-resizable-panels": "^2.1.3"
+ "splitpanes": "^4.0.0"

- "react-intersection-observer": "^9.16.0"
+ (use @vueuse/core's useIntersectionObserver)

- "react-markdown": "^10.1.0"
+ "markdown-it": "^14.x"  (+ existing DOMPurify + rehype-sanitize equivalent)

- "react-blurhash": "^0.3.0"
+ tiny in-repo composable (~40 LOC, already available on GitHub gists)

- "recharts": "^2.12.7"
+ "vue-chartjs" + "chart.js"  OR  "@unovis/vue"   ← DECIDE IN PHASE 1

- "cmdk": "^1.0.0"
+ shadcn-vue's "Command" (built on reka-ui) — already part of shadcn-vue

- "input-otp": "^1.2.4"
+ shadcn-vue OTP (reka-ui) OR "vue-pincode-input"

- "vaul": "^1.1.2"
+ "vaul-vue": "^0.4.x"

- "react-easy-crop"
+ "vue-advanced-cropper"

- "@testing-library/react": "^16.3.2"
+ "@vue/test-utils": "^2.4.0"

+ "@vueuse/core": "^11.x"        // replaces many ad-hoc hooks
+ "pinia": "^2.3.0"              // replaces React Context + local state stores
```

---

## 5. Directory layout (target)

We keep directory names stable so git history follows files through renames (`git log --follow`).

```
src/
├── main.ts                 (was main.tsx — mount createApp(App))
├── App.vue                 (was App.tsx — providers and root template)
├── AppRouter.ts            (was AppRouter.tsx — exports createRouter config)
├── components/
│   ├── ui/                 ← copied from shadcn-vue + re-skinned
│   └── …                   ← 327 React components → .vue SFCs
├── composables/            (was hooks/ — renamed because every file changes anyway)
│   ├── useCurrentUser.ts
│   └── …                   ← 155 composables
├── stores/                 (NEW — Pinia stores; replaces ~half the Contexts)
│   ├── app.ts              (was AppContext)
│   ├── dm.ts               (was DMContext)
│   ├── audio.ts            (was AudioPlayerContext)
│   └── …
├── lib/                    (unchanged — pure TS)
├── pages/                  (76 pages → .vue SFCs)
├── blobbi/                 (subtree ported last — deepest integration)
└── test/                   (setup.ts needs a tiny tweak for Vue test utils)
```

**Rename:** `src/hooks/` → `src/composables/`, because every file's contents change and keeping the React-specific name would be misleading. Git will still track the rename (`git mv`).

---

## 6. Phased plan

We will **not** do a single 3-month branch. Each phase below lands as a separate PR into `feat/react-to-vue-migration` and is reviewable independently. Every phase ends with a **working, buildable state** (possibly running both React and Vue side-by-side via the Vite plugin dual-install trick from Phase 2).

### Phase 0 — This PR (plan only)
**Issue:** KUBO-040
**Deliverable:** this document + branch + PR on `JeroenOnNostr/kubo`.
**Scope:** no code changes. Just alignment.

### Phase 1 — Spike & decisions (1–2 days)
**Issue:** KUBO-041
**Deliverable:** one throwaway branch that:
- Stands up an empty Vite + Vue 3 + TS + Tailwind project in `apps/vue-sandbox/` using **the existing Tailwind config** unchanged.
- Ports **one simple Kubo page** (e.g. `CSAEPolicyPage` — near-zero business logic) to a Vue SFC.
- Ports **one complex interactive component** (e.g. `ComposeBox` or a feed post) as a feasibility check.
- Picks the recharts replacement (`@unovis/vue` vs `vue-chartjs`) with a trial port of one chart.
- Locks down the **Nostrify-without-`@nostrify/react`** composable pattern — this is the single highest-risk technical decision.
- Benchmarks bundle size (eyeball only).
- **Outcome:** updated plan with concrete library choices resolved, or a recommendation to **abort** and stay on React.

**Gating:** Jeroen reviews the spike and explicitly green-lights Phase 2. If the spike reveals insurmountable issues (Nostrify composable doesn't work cleanly, shadcn-vue coverage is too thin, bundle size doubles), we stop here and the plan is amended or abandoned. Cost sunk: a week at most.

### Phase 2 — Tooling & dual-build setup (2–3 days)
**Issue:** KUBO-042
**Deliverable:**
- Add `vue`, `@vitejs/plugin-vue`, `vue-router`, `@tanstack/vue-query`, `pinia`, `@vueuse/core`, `lucide-vue-next`, `reka-ui`.
- Add `vue-tsc` to the test script alongside `tsc`.
- Add `eslint-plugin-vue` + Vue parser; keep React rules for files that still exist.
- Add `vite.config.ts` updates so both plugins coexist during the migration.
- Create `src/composables/` and `src/stores/` folders (empty + README).
- Copy **all** 53 shadcn-vue primitives into `src/components/ui-vue/` (parallel directory — we don't delete React primitives yet). Re-apply Kubo customisations as they are ported.
- Port `@unhead/react` → `@unhead/vue` at the infrastructure level only.

**Outcome:** `npm run build` still produces a working React app. Vue stack is installed but unused in production code.

### Phase 3 — Foundational composables (1 week)
**Issue:** KUBO-043
**Deliverable:** port the 20-ish foundational composables that everything else depends on. Example list:
- `useCurrentUser`, `useAppContext` → Pinia `useAppStore()`
- `useAuthor`, `useAuthors` (TanStack Query wrappers)
- `useNostr()` composable replacing `@nostrify/react`'s `useNostr`
- `useNostrPublish`, `usePendingNostrEvent`
- `useFeedSettings`, `useTheme`
- `useProfileUrl`, `useNIP05`
- Login plumbing: `useNostrLogin()` replacing `NostrLoginProvider`

Every new composable ships with a **parallel React hook** that delegates to it (so React pages can still call `useCurrentUser()` during the transition). This is the "both worlds coexist" trick.

### Phase 4 — Shell & routing (1 week)
**Issue:** KUBO-044
**Deliverable:**
- `main.ts` replaces `main.tsx`.
- `App.vue` replaces `App.tsx` — top-level providers become `provide()` / Pinia / VueQuery plugin.
- `AppRouter.ts` — full Vue Router config mirroring the 70-odd routes from `AppRouter.tsx`, using `component: () => import('./pages/XxxPage.vue')` for lazy chunks.
- `MainLayout.vue`, `KuboParentLayout.vue`, `KuboOnboardLayout.vue`, `KuboKidLayout.vue` — the four layouts.
- `ErrorBoundary.vue` using `onErrorCaptured`.

After this phase, navigating the app shell works and **one placeholder page** renders inside each layout. Every other route shows a "page not yet migrated" stub.

### Phases 5–9 — Pages & components (8–12 weeks)
**Issues:** KUBO-045 through KUBO-049 (one issue per batch)
**Split the 76 pages into 5 batches** by dependency graph, not alphabetically:

- **Batch A: Read-only Kubo-specific pages** — `WelcomePage`, `CSAEPolicyPage`, `ChangelogPage`, `HelpPage`, `KuboPlaceholderPage`. Cheapest. Warm-up.
- **Batch B: Parent flow** — `KidDashboardPage`, `KidKeysPage`, `EditKidSettingsPage`, `EditKidFeedSettingsPage`, `AddKidPage`, `TrustPeoplePage`, `TrustPlacesPage`, `ParentTrustIndexPage`, `ParentFeedPage`, `ContentUploaderPage`, `VideoViewPage`, `ProfileViewPage`, `GroupViewPage`, `WoTScorePage`, `KidHomePage`. Kubo-specific; no upstream code.
- **Batch C: Core Nostr feed** — `Index`, `NotificationsPage`, `ProfilePage`, `SearchPage`, `TrendsPage`, `NotFound`, `NIP19Page`, `HashtagPage`, `GeotagPage`, `DomainFeedPage`, `PhotosFeedPage`, `VideosFeedPage`, `VinesFeedPage`. Highest-traffic; most complex reused components.
- **Batch D: Settings & auth** — all `settings/*` pages, `RelayPage`, `FollowPage`, `RemoteLoginSuccessPage`.
- **Batch E: Long-tail kinds & Blobbi** — `ArticleEditorPage`, `BadgesPage`, `BlobbiPage` (+ whole `src/blobbi/` subtree), `WorldPage`, `MusicPage`, `PodcastsFeedPage`, `EventsFeedPage`, `TreasuresPage`, `ThemesPage`, `BooksPage`, `ArchivePage`, `BlueskyPage`, `WikipediaPage`, `AIChatPage`, `BookmarksPage`, `LettersPage`, `LetterComposePage`, `LetterPreferencesPage`, `WebxdcFeedPage`, `UserListsPage`.

For each batch: pick it up, port pages one at a time, remove React entries from `AppRouter.tsx` and add Vue entries to `AppRouter.ts` atomically. At any time, the app is a hybrid — but we don't need a "hybrid runtime" because **we flip one page at a time from React-render to Vue-render via routing**, and neither stack needs to know the other exists per-page.

Caveat: some components are shared across pages (e.g. `NoteCard`, `ProfileLink`, `ComposeBox`). They must be ported before any page that depends on them. Phase 1 spike should produce the dependency order.

### Phase 10 — React removal & cleanup (1 week)
**Issue:** KUBO-050
**Deliverable:**
- Delete every `*.tsx` file and the entire `src/hooks/` directory.
- Delete `src/components/ui/` (the React primitives); `ui-vue/` gets renamed to `ui/`.
- Remove React dependencies from `package.json` (§4).
- Remove `@vitejs/plugin-react` + react-specific eslint plugins.
- Update `eslint.config.js`, `tsconfig.json` for Vue-only.
- Update `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `CLAUDE.md` references to React.
- Update the Kubo memory file (`~/.claude/.../memory/kubo.md`) — tech stack line becomes `Vue 3 + TypeScript + Vite`.

### Phase 11 — Mobile smoke test & ship (3–5 days)
**Issue:** KUBO-051
**Deliverable:**
- `npm run cap:sync` produces a working Android APK.
- Full manual QA pass on Pixel 7 + iPhone 12 Pro emulators (already in the dev workflow per memory).
- Status-bar theming from `main.tsx` is reproduced in `main.ts` and verified on device.
- Zap-store publishing path is unblocked (KUBO-020 / kubo-zapstore-publish memory): nothing in the Vue migration should impact signing, but the APK must be re-signed for release.

---

## 7. Bundle & performance budget

Measure **before** and **after** with `rollup-plugin-visualizer` (already wired in `vite.config.ts`).

| Metric | Target |
|---|---|
| Gzip JS total | ≤ current React build + 10% |
| Initial route chunk | ≤ 250 KB gzip (mobile 3G budget) |
| Blobbi companion layer | stays code-split (~450 KB) |
| Time-to-interactive on Pixel 7 emulator | ≤ current baseline |

Vue 3 is slightly smaller than React per-component runtime, but we lose `lucide-react`'s tree-shaking friendliness slightly with `lucide-vue-next` — needs measurement.

---

## 8. Testing strategy

**Reality check:** Kubo has 6 test files. The migration cannot hide behind test coverage we don't have. What we can do:

1. **Smoke tests:** one `@vue/test-utils` mount test per ported page, asserting it renders without errors. Cheap insurance against typos.
2. **Manual QA checklist** per page batch, documented in the corresponding PR.
3. **Dev-server manual testing in browser + mobile emulator** before each batch merges (per the `feedback_verify_ui_in_browser.md` memory — tsc+lint is not enough).
4. **Post-migration:** consider adding a Playwright smoke test for the critical path (login → feed → post → reply → zap). Out of scope for this plan but worth a KUBO-xxx after Phase 11.
5. **`npm run test`** must pass (tsc + vue-tsc + eslint + vitest + vite build) at every batch merge — the `AGENTS.md` engineering rule still applies.

---

## 9. Upstream Ditto divergence — the uncomfortable part

Kubo is a **soft-fork** of Ditto. The whole point of `main` tracking `upstream/main` (per `kubo.md`) is that we pull Ditto's React features into Kubo for free. **The moment we move to Vue, that pipeline dies.**

Options (to be decided before Phase 2 starts):

- **Option A — Accept the divergence (recommended if we go ahead).** `main` becomes an archival tracker of upstream Ditto for reference reading only; `brand/main` becomes the canonical branch; the upstream sync flow documented in `kubo.md` is deleted. Every useful Ditto PR going forward must be read, understood, and re-implemented in Vue by hand on `brand/main`. The value of the fork becomes the Nostr domain knowledge encoded in our Vue code, not shared React plumbing.
- **Option B — Maintain a React compat lane.** Keep the React `main` alive so we can still cherry-pick Ditto fixes, but forbid rendering it. Feels like overhead with no payoff.
- **Option C — Don't migrate; do the UI cleanup within React instead.** If the motivation for "move to Vue" is ergonomics or personal preference, it's worth quantifying what Vue buys us that a React-internal cleanup (Tailwind tightening, state-store consolidation, getting off React Context, switching to zustand/jotai) wouldn't. **This is the "should we even do this?" question.**

The user should pick A, B, or C before Phase 1 kicks off. Phase 0 (this plan) explicitly does not make that decision.

---

## 10. Alternative: big-bang rewrite

Instead of phasing inside one repo, fork `kubo` → `kubo-vue`, port page-by-page from scratch, retire React `kubo` when parity is reached.

- **Pros:** cleaner history; no dual-stack Vite contortions; lets us re-think modeling as we go.
- **Cons:** no incremental testing against real users; estimated 2–3× wall-clock because we can't lean on the existing build working; merge back is messier.

The **incremental plan above is recommended** over big-bang. But it's on the table.

---

## 11. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| shadcn-vue coverage gaps (a primitive we use has no Vue twin) | Medium | High | Spike in Phase 1 enumerates the 53 primitives and maps each to reka-ui/shadcn-vue; any gap gets a custom port plan before Phase 2 starts. |
| `@nostrify/react` replacement turns out to need substantial work | Medium | High | Phase 1 must deliver a working `useNostr()` composable. If it can't, we stop. |
| Blobbi subsystem doesn't port cleanly (animation timing, React-specific hooks) | Medium | Medium | Scheduled last (Batch E). Can live as an isolated React island temporarily if absolutely needed (Vue + React interop via a custom element wrapper). |
| Upstream Ditto ships a major feature mid-migration (e.g. new NIP support we want) | High | Medium | Phase 4 onwards: port it manually. Accept the cost. |
| Bundle size regresses > 10% | Medium | Medium | Measure after each batch. If we trend bad, stop and fix before continuing. |
| Capacitor APK breaks | Low | High | `npm run cap:sync` is validated at Phase 4 (shell works) and Phase 11 (final). Nothing in the web-to-native bridge cares about framework. |
| Reviewer fatigue (PRs too big) | High | Medium | Batches A–E are ≤ 20 pages each. Each component-level port is its own commit within the batch PR. |
| Mid-migration bug-fixes on `brand/main` need to be re-ported onto the Vue side | High | Low | Cherry-pick policy: any hotfix landing on `brand/main` during the migration also lands on `feat/react-to-vue-migration` the same day. Use `git cherry-pick`. |
| We realize midway Vue is worse for our use case | Low | Catastrophic | Phase 1 spike is the go/no-go. Don't skip it. |

---

## 12. Effort estimate

Assuming the current solo-developer cadence and that this is not full-time:

| Phase | Calendar estimate |
|---|---|
| 0 — Plan | done (this doc) |
| 1 — Spike | 3–5 days |
| 2 — Tooling | 2–3 days |
| 3 — Foundational composables | 5–7 days |
| 4 — Shell & routing | 5–7 days |
| 5 — Batch A (warm-up pages) | 3–5 days |
| 6 — Batch B (parent flow) | 1.5–2 weeks |
| 7 — Batch C (core feed) | 2–3 weeks ← hardest |
| 8 — Batch D (settings) | 1–1.5 weeks |
| 9 — Batch E (long-tail + Blobbi) | 2–3 weeks |
| 10 — React removal | 3–5 days |
| 11 — Mobile smoke | 3–5 days |
| **Total** | **~3–4 months of focused effort** |

If part-time across multiple projects, multiply by 2–3×.

---

## 13. What this PR does NOT do

- It does **not** add Vue to `package.json`. No code changes at all — just this markdown file.
- It does **not** start Phase 1. Approval on this plan is prerequisite.
- It does **not** make the upstream-divergence decision (§9). That's a separate conversation.
- It does **not** break anything — `brand/main` is untouched.

## 14. Next step

If the plan is green-lit: open KUBO-041 and start the Phase 1 spike branch off `brand/main` named `spike/vue-feasibility`. If not: amend this doc and re-push.
