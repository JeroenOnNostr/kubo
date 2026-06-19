# Kubo — Full-App Audit (2026-06-18)

## Executive Summary

A whole-app sweep reviewed every source file; each finding below was confirmed by a 2-of-3 adversarial vote. No P0 or P1 issues survived verification — the confirmed findings are localized correctness/quality defects (observer/promise leaks, a stale-republish data bug, and dead/fragile UI code). This is a post-budget-reset worklist: each item is independently actionable and carries a suggested KUBO-NEW issue tag for TODO.md.

| Severity | Count |
|---|---|
| P0 | 0 |
| P1 | 0 |
| P2 | 2 |
| P3 | 6 |

**Coverage:** This was a full-coverage sweep — every source file in the app was reviewed.

---

## P2 — Important

### 1. ArchiveOrgEmbed ResizeObserver is never disconnected (observer leak)
**File:** `src/components/ArchiveOrgEmbed.tsx:80-91`

**Why it's real (3/3):** The `containerRef` ref-callback creates a `new ResizeObserver(...)`, calls `ro.observe(node)`, and stores it in `observerRef.current`, but there is no cleanup. The ref-callback only early-returns when `node` is null (detach) and never calls `ro.disconnect()`. There is no `useEffect` cleanup either. Each time the component mounts (and every time React re-runs the callback ref) a new ResizeObserver is created and left observing, holding a closure over `setContainerWidth` — leaking observers across the feed where many embeds mount/unmount.

**Fix:** In the ref callback, when `node` is null, call `observerRef.current?.disconnect()` before returning; and/or add `useEffect(() => () => observerRef.current?.disconnect(), [])` to disconnect on unmount. Move the `observerRef` declaration above the callback for clarity.

**Suggested issue: KUBO-NEW**

### 2. Deleting all custom profile fields silently re-publishes the old fields
**File:** `src/components/EditProfileForm.tsx:217-242`

**Why it's real (3/3):** `metadata` comes from `n.json().pipe(n.metadata())` where `n.metadata()` is a `z.looseObject` (verified in `node_modules/@nostrify/nostrify/NSchema.ts`), so a prior kind-0 `fields` key is retained on `metadata`. In onSubmit `data = { ...metadata, ...standardMetadata }` (standardMetadata excludes `fields`), so `data.fields` = the OLD fields array. The new-fields block is gated by `if (customFields && customFields.length > 0)` / `if (nonEmptyFields.length > 0)`. If the user removes every custom field (`customFields` is `[]`), that block is skipped and the stale `data.fields` is left untouched. The cleanup loop only deletes `=== ''` values, not the array. The kind-0 is then published with the deleted fields still present.

**Fix:** Before publishing, always normalize `fields`: compute `nonEmptyFields` and set `data.fields = nonEmptyFields.map(...)` when non-empty, else `delete data.fields` — mirroring how `shape` is handled (set-or-delete) so an emptied field list actually clears the published `fields`.

**Suggested issue: KUBO-NEW**

---

## P3 — Minor / Cleanup

### 3. useApplyFavicon: uncaught promise rejection when the logo image fails to load
**File:** `src/components/AppProvider.tsx:258-266`

**Why it's real (3/3):** In `updateFavicon`, `await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(); })` is awaited with no surrounding try/catch (the only try/catch wraps the earlier `fetch('/logo.svg')`). If the blob-URL image fails to decode, `img.onerror` rejects, the rejection escapes `updateFavicon`, and since `updateFavicon()` is invoked fire-and-forget in the effect body it becomes an unhandled promise rejection (and the favicon update silently aborts mid-way).

**Fix:** Wrap the image-load await in try/catch (return on failure), or reject with an Error and `.catch()` the `updateFavicon()` call. E.g. `img.onerror = () => reject(new Error('favicon image load failed'));` plus a try/catch around the await.

**Suggested issue: KUBO-NEW**

### 4. AudioVisualizer: unhandled audio.play() promise rejections
**File:** `src/components/AudioVisualizer.tsx:180, 197`

**Why it's real (3/3):** `togglePlay` calls `audio.play()` (line 180) and `handleCanvasClick` calls `audio.play()` (line 197) without awaiting/catching. `HTMLMediaElement.play()` returns a Promise that rejects under browser/Capacitor autoplay policies or when the media errors. On Android/iOS WebView the rejection surfaces as an uncaught promise rejection, and the user gets no feedback (`hasStarted` stays false but the play button keeps showing).

**Fix:** Capture and ignore/handle the rejection, e.g. `void audio.play().catch(() => {})`, at both call sites, or surface a UI error state.

**Suggested issue: KUBO-NEW**

### 5. DMProvider: hardcoded recency threshold ignores the named constant
**File:** `src/components/DMProvider.tsx:596, 657, 861, 1034`

**Why it's real (3/3):** `DM_CONSTANTS.RECENT_MESSAGE_THRESHOLD` is defined as 5000 but every recency check uses the magic literal `if (messageAge < 5000)` (lines 596, 657, 861, 1034). A future change to the constant will silently not take effect.

**Fix:** Replace the four `< 5000` literals with `< DM_CONSTANTS.RECENT_MESSAGE_THRESHOLD`.

**Suggested issue: KUBO-NEW**

### 6. AccountSwitcher: active-account indicator dot is dead code (never renders)
**File:** `src/components/auth/AccountSwitcher.tsx:79`

**Why it's real (3/3):** The dot `{user.id === currentUser.id && <div ... bg-primary>}` is rendered inside `otherUsers.map(...)`. `useLoggedInAccounts` defines `otherUsers = (authors || []).slice(1)` — i.e. every account EXCEPT the current one (currentUser is index 0). So inside this map `user.id` can never equal `currentUser.id`, the condition is always false, and the active indicator never shows.

**Fix:** Either render the indicator against the actual logged-in/selected account (include currentUser in the list and compare, or render a 'current' row separately), or remove the dead conditional. As written it conveys no information.

**Suggested issue: KUBO-NEW**

### 7. AddToListDialog re-publishes Follow Pack with duplicate p-tag on repeated/stale add
**File:** `src/components/AddToListDialog.tsx:75-93`

**Why it's real (2/3):** `handleAddToPack` builds `newTags = [...pack.event.tags, ['p', pubkey]]` and republishes kind 39089 without checking whether `pubkey` is already present. The add button is only disabled via `inPack = pack.pubkeys.includes(pubkey) || addedPackIds.has(pack.id)`, derived from the cached `pack.pubkeys`; if that cache is stale (or the same user is added via two surfaces) the existing `p` tag is not deduplicated, producing a replaceable event with duplicate `['p', pubkey]` entries.

**Fix:** Before appending, guard against duplicates: `if (pack.event.tags.some(([n, v]) => n === 'p' && v === pubkey)) { ... skip ... }`, or build newTags by filtering out any existing matching p-tag first.

**Suggested issue: KUBO-NEW**

### 8. ExternalFavicon error fallback never shows when fallback omitted, and relies on fragile sibling lookup
**File:** `src/components/ExternalFavicon.tsx:61-74`

**Why it's real (2/3):** The img onError sets `e.currentTarget.style.display = 'none'` then reveals `nextElementSibling`. The fallback span is only rendered when `fallback` is truthy (`{fallback && (...)}`). If a caller passes no `fallback` but the favicon 404s, the image is hidden, leaving an empty box. Also `nextElementSibling` breaks if markup order changes.

**Fix:** Render the hidden fallback span unconditionally (even empty), or track load failure in React state and render the fallback declaratively instead of mutating DOM siblings.

**Suggested issue: KUBO-NEW**
