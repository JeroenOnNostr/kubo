# Kubo — Full-App Audit, Part 2 (2026-06-18)

## Executive Summary

Part 2 of the whole-app sweep (the wave-batched re-run after the first pass was rate-limited). Every kubo source file outside the 3 chunks already covered in `AUDIT-FULL-2026-06-18.md` was reviewed; each finding below was confirmed by a 2-of-3 adversarial verifier vote. One P1 (daily-mission XP re-awarded on every refresh) and 14 P2 correctness/data bugs survived verification. This is a post-reset worklist; each item carries a suggested KUBO-NEW issue tag.

| Severity | Count |
|---|---|
| P0 | 0 |
| P1 | 1 |
| P2 | 14 |
| P3 | 44 |

> Note: writer agent was cut off by the session limit; this file was reconstructed from the verified-findings payload in the workflow transcript (no data lost).

---

## P1 — High

### 1. Daily-mission XP is re-awarded on every page refresh (XP inflation)
**File:** `src/blobbi/actions/hooks/useClaimMissionReward.ts:61-95`  ·  **Kind:** bug  ·  **Votes:** 3/3

**Why it's real:** useAwardDailyXp computes xpToAward = totalDailyXp(missions), which returns the FULL XP of all completed daily missions plus the all-complete bonus every time it is called, then writes newTotalXp = currentXp + xpToAward to the profile. The hook itself has no idempotency: it does not record that today's daily XP was already granted. The only guard is dailyXpAwardedRef in BlobbiPage.tsx (line 1303-1310), an in-memory ref keyed by date that resets to null on every page reload. So a user who completes all dailies (XP granted, persisted to kind 11125), then refreshes the page while allComplete is still true, will trip the effect again and have the same daily XP (incl. the 50 DAILY_BONUS_XP) added to their persisted total a second time, and again on each subsequent refresh.

**Fix:** Make the award idempotent at the data layer: persist an 'awarded' marker (e.g. missions.dailyXpAwardedDate or per-mission awarded flags) into the kind 11125 missions content, and in the mutationFn re-read the fresh profile's missions content and subtract already-awarded XP (or no-op if today is already marked) before computing xpToAward. Do not rely solely on the in-memory ref in the caller.

**Suggested issue: KUBO-NEW**

## P2 — Important

### 2. Contact-use cooldown check is keyed by instanceId but the provided cooldown store is keyed by itemId, defeating retry-spam protection
**File:** `src/blobbi/companion/interaction/HangingItems.tsx:444-456, 628, 764`  ·  **Kind:** bug  ·  **Votes:** 3/3

**Why it's real:** checkItemCooldown(itemId) at line 444 calls the prop isItemOnCooldown(itemId) when provided. attemptUseItem (line 626) is always called with instanceId (e.g. line 764 attemptUseItem(data.instanceId, ...) and line 628 checkItemCooldown(instanceId)). The prop wired in BlobbiCompanionLayer.tsx:320 is useBlobbiItemUse.isItemOnCooldown, whose store (itemCooldowns Map in useBlobbiItemUse.ts:126) is keyed by itemId, and setItemCooldown is called with itemId (onSuccess/onError). An instanceId like `${item.id}-${now}-${counter}` never matches an itemId key, so the prop-based cooldown always returns false. The intended protection against an item repeatedly auto-using on Blobbi contact is silently bypassed; only the itemsBeingUsedRef in-flight guard remains.

**Fix:** Decide one key consistently. Either pass item.id (the type id) to checkItemCooldown/setLocalCooldown for the prop path while keeping instanceId for the local in-flight set, or have useBlobbiItemUse expose an instance-aware cooldown. Simplest: in attemptUseItem, call checkItemCooldown(item.id) when an external isItemOnCooldown prop is present, and keep instanceId only for itemsBeingUsedRef/local fallback.

**Suggested issue: KUBO-NEW**

### 3. parseStorageTags crashes on a malformed 'storage' tag with no value
**File:** `src/blobbi/core/lib/blobbi.ts:463-474`  ·  **Kind:** bug  ·  **Votes:** 3/3

**Why it's real:** parseStorageTags maps over every ['storage', ...] tag and immediately calls `tag[1].split(':')`. The `.filter(item => item.itemId && !isNaN(item.quantity) ...)` guard runs AFTER the map, so it cannot protect the split. A remote/legacy kind-11125 event containing a bare `['storage']` tag (tag[1] === undefined) makes `tag[1].split` throw 'Cannot read properties of undefined', crashing the parse. This is reached from untrusted network data (useBlobbiMigration.ts:223 calls parseStorageTags(profileTags)).

**Fix:** Guard before splitting: in the map, read `const raw = tag[1]; if (!raw) return null;` (or destructure with a default), then filter out null entries. e.g. `.map(tag => { const raw = tag[1]; if (typeof raw !== 'string') return null; const [itemId, q] = raw.split(':'); return { itemId, quantity: parseInt(q, 10) }; }).filter((i): i is StorageItem => !!i && !!i.itemId && !isNaN(i.quantity) && i.quantity > 0)`.

**Suggested issue: KUBO-NEW**

### 4. Hatch mutation failure is swallowed; ceremony proceeds as if egg became a baby
**File:** `src/blobbi/onboarding/components/BlobbiHatchingCeremony.tsx:430-454`  ·  **Kind:** data-loss  ·  **Votes:** 3/3

**Why it's real:** On the final crack click, `executeHatch().catch(console.error)` fires the publish that turns the egg into a baby, but its rejection is only logged. The UI unconditionally advances via setTimeout to flash -> reveal -> dialog -> naming, showing the hatched baby Blobbi. If the publish failed (relay/signer error), no toast is shown and the on-relay state is still an egg, while the user is told it hatched. `eggTagsRef.current` is also only updated inside executeHatch after success, so completeCeremony later persists the name onto whichever tags survived, masking the failure.

**Fix:** Await executeHatch and branch on failure: show a destructive toast and either retry or block the reveal, instead of `.catch(console.error)` while the animation proceeds regardless.

**Suggested issue: KUBO-NEW**

### 5. Voice reply to a NIP-22 comment points root tags at the comment, breaking threading
**File:** `src/components/ComposeBox.tsx:725-733`  ·  **Kind:** bug  ·  **Votes:** 3/3

**Why it's real:** In handleStopAndPublishVoice, for any non-URL NIP-22 reply it unconditionally emits uppercase root tags `['E', replyTo.id]`, `['K', replyTo.kind.toString()]`, `['P', replyTo.pubkey]`. When replyTo is itself a kind-1111 comment, NIP-22 requires the uppercase (E/K/P/A) tags to reference the ORIGINAL root, not the parent comment — exactly what the text path does (lines 945-995 reconstruct the root from the comment's K/P/A/E/I tags). The voice path skips that reconstruction, so a voice reply to a comment is mis-rooted: it claims the comment is the conversation root, fragmenting the thread.

**Fix:** Mirror the text path: when `replyTo.kind === 1111`, reconstruct the root from replyTo's uppercase K/P/A/E/I tags for the uppercase root tags, and use replyTo only for the lowercase parent (e/k/p) tags.

**Suggested issue: KUBO-NEW**

### 6. FeedEditModal.handleSave does not catch onSave rejection — unhandled promise + no error feedback + modal stuck open
**File:** `src/components/FeedEditModal.tsx:122-150`  ·  **Kind:** bug  ·  **Votes:** 3/3

**Why it's real:** handleSave does `await onSave(label.trim(), filter, vars); onOpenChange(false);` with no try/catch. The wired callers in ContentSettings.tsx (handleAddFeed/handleEditFeed, lines 754-764) `await addSavedFeed(...)` / `await updateSavedFeed(...)`, which can reject (publish/relay failure). On rejection: the await throws, `onOpenChange(false)` never runs (modal stays open on a now-half-applied state), the success toast in the caller never fires, the user gets zero feedback, and React surfaces an unhandled promise rejection. The component shows isPending spinners but never surfaces a failure.

**Fix:** Wrap the await in try/catch: on success call onOpenChange(false); on error show a destructive toast (or rethrow into an onError prop) and keep the modal open with controls re-enabled. Do not unconditionally close after the await.

**Suggested issue: KUBO-NEW**

### 7. Kind-3 query failure during onboarding silently skips the Follows step for new users
**File:** `src/components/InitialSyncGate.tsx:386-409`  ·  **Kind:** bug  ·  **Votes:** 3/3

**Why it's real:** In handleSaveAndContinue, the catch block sets `userHasFollows = true` on any failure of `nostr.query([{ kinds: [3], authors: [user.pubkey], limit: 1 }], { signal: AbortSignal.timeout(5000) })`. When userHasFollows is true the flow does `goTo('outro')` and never shows FollowsStep. A 5s relay timeout (most likely on a brand-new account that in fact has zero follows) thus routes the empty-feed user straight to the outro and hides the curated follow packs — exactly the users the step exists for end up with an empty feed.

**Fix:** On query failure, default to `userHasFollows = false` (fail toward showing the Follows step), or treat the timeout distinctly. The follows step is harmless to show to a user who already has follows (they can Skip), but skipping it leaves new users stranded with an empty feed.

**Suggested issue: KUBO-NEW**

### 8. NIP-38 status publish failures are silently swallowed (no catch / unhandled rejection)
**File:** `src/components/MobileDrawer.tsx:185, 200, 214`  ·  **Kind:** bug  ·  **Votes:** 3/3

**Why it's real:** All three status-editor save/clear paths call `publishStatus.mutateAsync({ status }).then(() => { setStatusEditing(false); toast({ title: 'Status updated' }) })` with no `.catch()`. usePublishStatus's useMutation has no `onError`. If the signer rejects (e.g. Amber/bunker denies) or the publish fails, the promise rejects: the success toast never shows, the editor never closes, and the rejection is unhandled. The user sees the status field stuck with no feedback and believes nothing happened.

**Fix:** Add a `.catch()` to each mutateAsync call (line 185, 200, 214) that shows a destructive toast (e.g. 'Couldn't update status') and leaves the editor open, or add an onError handler to usePublishStatus. Prefer awaiting in an async handler with try/catch.

**Suggested issue: KUBO-NEW**

### 9. Multiple-choice polls can only ever record one selected option
**File:** `src/components/PollContent.tsx:181-198`  ·  **Kind:** bug  ·  **Votes:** 3/3

**Why it's real:** The component renders a 'Multiple choice' badge and tallyVotes()/getVotersForOption() iterate over many 'response' tags, but the voting UI tracks a single `selectedOption: string | null` and each option button does `onClick={() => setSelectedOption(opt.id)}` (overwriting any prior pick). handleVote then publishes exactly one tag: `['response', selectedOption]`. For polltype 'multiplechoice' a voter therefore can never cast more than one choice, contradicting the poll type and the tally logic.

**Fix:** For multiplechoice, track a Set/array of selected option ids (toggle on click) and emit one `['response', id]` tag per selected option in handleVote; keep single-string behavior only for singlechoice.

**Suggested issue: KUBO-NEW**

### 10. ProfileReactionButton publishes profile reactions with no TEPP/action-visibility gating
**File:** `src/components/ProfileReactionButton.tsx:35-62`  ·  **Kind:** bug  ·  **Votes:** 3/3

**Why it's real:** handleReact publishes a kind-7 reaction via useNostrPublish whenever `user` is truthy, with no useActionVisibility/teppVerdict check. By contrast PostActionBar gates every interaction (reaction/repost/zap) behind `av.showReaction` and surfaces a 'request to interact' flow when TEPP denies interaction. A kid in TEPP view-only mode can therefore react to (and thereby publicly interact with) any profile through this button, bypassing the parental interaction gate enforced elsewhere.

**Fix:** Run the same useActionVisibility(profileEvent) gate (or an equivalent TEPP check on profileEvent.pubkey) before allowing the reaction, hiding/disabling the button and routing to the request-interact flow when interaction is denied.

**Suggested issue: KUBO-NEW**

### 11. Profile tabs use label as React key and dnd-kit id — duplicate labels corrupt reorder/edit/remove
**File:** `src/components/ProfileTabsManagerModal.tsx:124-131`  ·  **Kind:** bug  ·  **Votes:** 3/3

**Why it's real:** SortableContext items are `localTabs.map((t) => t.label)`, each row keys on `tab.label`, and handleDragEnd/handleRemove/handleTabSaved all match tabs by label (e.g. `prev.findIndex((t) => t.label === active.id)`, `prev.filter((t) => t.label !== label)`, `prev.map((t) => t.label === editingTab.label ? tab : t)`). ProfileTabEditModal does not enforce unique labels, so two tabs with the same label make dnd report a non-unique id and cause remove/edit to affect the wrong or multiple tabs, silently losing or duplicating tab config.

**Fix:** Give each ProfileTab a stable unique id (generate on create) and use it for the React key, dnd id, and all find/filter/map matching; fall back to index only as a last resort.

**Suggested issue: KUBO-NEW**

### 12. Relay with read+write both disabled silently vanishes from published NIP-65 list while persisting locally
**File:** `src/components/RelayListManager.tsx:214-225`  ·  **Kind:** bug  ·  **Votes:** 3/3

**Why it's real:** handleToggleRead and handleToggleWrite are independent, so a user can switch both Read and Write off for a relay. saveRelays() stores that {read:false, write:false} entry in local config (updateConfig keeps newRelays verbatim), but publishNIP65RelayList maps it to null and filters it out (comment: "shouldn't happen"). The published kind-10002 event therefore omits a relay the UI still shows as present, so local config and the broadcast relay list diverge and the relay is silently dropped for other clients.

**Fix:** Either prevent toggling both off (re-enable the opposite switch, or remove the relay) or include the entry in the NIP-65 event (e.g. keep it as a bare 'r' tag) so local state and published state stay consistent.

**Suggested issue: KUBO-NEW**

### 13. KidNavigationInterceptor routes inline NIP-05 mentions to the wrong profile (post author, not the mentioned user)
**File:** `src/components/feed/KidNavigationInterceptor.tsx:119-132`  ·  **Kind:** bug  ·  **Votes:** 3/3

**Why it's real:** The nip05Match branch derives the npub from the wrapper's `pubkey` prop (the post author) via `nip19.npubEncode(pubkey)`. The NIP05_PATH regex also matches inline @mention anchors inside NoteContent (`/<user>@<domain>` or bare `/<domain>`), not only the post's own ActorRow. For any inline NIP-05 mention of a different user, the kid is navigated to /kid/profile/<post-author-npub> — the wrong person. The code comment itself acknowledges "for inline NIP-05 mentions we'd need richer DOM hints" but still navigates with the author pubkey rather than blocking.

**Fix:** When the anchor is not the post's own ActorRow (e.g. detect via a data attribute or compare the link text/known author), block the NIP-05 navigation (preventDefault + return) instead of routing to the post author's profile, so a kid never lands on a mislabeled profile.

**Suggested issue: KUBO-NEW**

### 14. sort:hot / sort:trending never reaches the relay query in useStreamPosts
**File:** `src/hooks/useStreamPosts.ts:325-341`  ·  **Kind:** bug  ·  **Votes:** 3/3

**Why it's real:** `initialFilter.search = searchParts.join(' ')` is assigned at lines 326-328, BEFORE the sort terms are pushed onto `searchParts` at lines 337-341 (`if (options.sort === 'hot') searchParts.push('sort:hot')`). Because the join already happened, mutating the array afterward has no effect — the NIP-50 `sort:hot`/`sort:trending` extension is silently dropped and the query is always returned in default (recent) order. `options.sort` is in the effect dep list (line 397) so callers expect it to work, but switching sort modes produces identical results.

**Fix:** Move the `options.sort` push block (lines 336-341) to BEFORE `const initialFilter ... initialFilter.search = searchParts.join(' ')` (line 325), alongside the other searchParts pushes, so the sort term is included in the joined search string.

**Suggested issue: KUBO-NEW**

### 15. getEffectiveRelays silently overrides user read/write flags with app defaults for shared relay URLs
**File:** `src/lib/appRelays.ts:84-94`  ·  **Kind:** bug  ·  **Votes:** 3/3

**Why it's real:** When useAppRelays is true, the merge iterates `[...APP_RELAYS.relays, ...userRelays.relays]` and keeps the FIRST occurrence per normalized URL (line 87-92). APP_RELAYS lists e.g. `wss://nos.lol/` with `write:false` and others with `write:true`. If a user's NIP-65 list contains the same URL with different read/write intent (e.g. user set relay.damus.io to read-only), the app default's flags win and the user's explicit per-relay read/write preference is silently discarded.

**Fix:** When a URL appears in both, prefer the user's relay object's read/write flags (e.g. build a map of user relays first and overlay, or push the user entry when a normalized URL collides) so user-configured permissions are not overwritten by app defaults.

**Suggested issue: KUBO-NEW**

## P3 — Minor / Cleanup

### 16. useAudioPlayback onpause handler captures stale `state`, so it never transitions to 'paused'
**File:** `/home/jeroen/VScode workspace for building nostr apps/kubo/src/blobbi/actions/hooks/useAudioPlayback.ts:158-162`  ·  **Kind:** bug  ·  **Votes:** 3/3

**Why it's real:** Inside `load` the handler `audio.onpause = () => { if (state === 'playing') setState('paused'); }` closes over the `state` value as it was when `load` ran. A fresh Audio is created on each `load`, and the handler is attached once at that moment when `state` is typically 'idle'/'loading', never 'playing'. So when the media element pauses (e.g. OS interruption, ended), this branch never fires. The state stays correct only because explicit `play()`/`pause()` set it directly, making this handler dead logic that can mask real pause events. `state` is also a dep of `load`, forcing the callback to be recreated on every transition.

**Fix:** Drop the dependence on the `state` closure: either remove the `state==="playing"` guard and unconditionally `setState('paused')` in onpause (or use a functional/ref read of current state), and remove `state` from `load`'s dependency array so the callback is stable.

**Suggested issue: KUBO-NEW**

### 17. Evolution-progress persist silently drops a batch when a publish is already in flight
**File:** `src/blobbi/actions/hooks/usePersistEvolutionProgress.ts:54-61`  ·  **Kind:** bug  ·  **Votes:** 3/3

**Why it's real:** persist() begins with `if (!pubkey || publishingRef.current) return;`. The debounce fires once PERSIST_DELAY_MS after the last 'daily-missions-updated' event. If a previous publish is still running (publishingRef true — fetchFreshEvent + publishEvent can take seconds on slow relays) when the timer fires, persist() returns immediately and the timer is NOT rescheduled. The mission progress accumulated during that window is never written to kind 11125 unless another mission update happens later to re-arm the debounce. On page refresh that interim evolution progress is lost.

**Fix:** When publishingRef.current is true, re-arm the debounce (e.g. set a pendingRef flag and re-run persist() in the finally block, or restart timerRef) so the latest store state is eventually flushed instead of dropped.

**Suggested issue: KUBO-NEW**

### 18. Evolution-progress persist swallows publish failures with only a console.warn
**File:** `src/blobbi/actions/hooks/usePersistEvolutionProgress.ts:94-98`  ·  **Kind:** quality  ·  **Votes:** 3/3

**Why it's real:** The debounced persist is invoked as `persist().catch((err) => console.warn(...))`. A failed publish (relay rejection, signer denial, offline) is logged to console only — there is no toast, retry, or re-arm. Because evolution progress lives only in an in-memory session store (daily-mission-tracker.ts) and is cleared on refresh, a silently failed persist means the user's hatch/evolve progress is lost on the next reload with no indication anything went wrong.

**Fix:** On persist failure, schedule a retry (re-arm the debounce timer) and/or surface a non-blocking toast so the failure is recoverable rather than silent.

**Suggested issue: KUBO-NEW**

### 19. leafy petal gradient declares stops in descending offset order, darkest at 100%
**File:** `src/blobbi/adult-blobbi/lib/adult-svg-customizer.ts:255-259`  ·  **Kind:** bug  ·  **Votes:** 3/3

**Why it's real:** customizeLeafy builds leafyPetal with stops listed as offset 100% (darkenColor(base,15)), then 30% (lightenColor(base,25)), then 0% (lightenColor(base,15)). Every other petal/body builder (buildPetalGradient, buildRadialGradient2Stop/3Stop/4Stop) lists stops in ascending 0%->100% order with the lighter highlight at 0%. Here the order is inverted and inconsistent: the lightest highlight (light25) sits at 30% while the 0% center is darker (light15), producing a different (and likely unintended) shading than all other forms. SVG renderers honor offsets as given, so the petal center is not the brightest point as the 3D-shading convention intends.

**Fix:** Reorder the stops ascending and align with the other builders: 0% -> lightenColor(base,25 or 30), 30/70% -> mid, 100% -> darkenColor(base,15); or simply call buildPetalGradient('leafyPetal', baseColor) as customizeRosey does for its outer petals.

**Suggested issue: KUBO-NEW**

### 20. Action-emotion override timer never cleared on unmount → setState on unmounted component
**File:** `src/blobbi/companion/hooks/useActionEmotionOverride.ts:36-39`  ·  **Kind:** bug  ·  **Votes:** 2/3

**Why it's real:** triggerOverride() schedules a 1500ms setTimeout that calls setActionOverride(null). The hook has no unmount cleanup useEffect. If BlobbiCompanionLayer unmounts (companion removed, navigation) within 1.5s of using an item, the timer still fires setActionOverride on an unmounted component, leaking the timer and producing a React 'state update on unmounted component' warning.

**Fix:** Add a useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []) cleanup so the pending override timer is cancelled on unmount.

**Suggested issue: KUBO-NEW**

### 21. onReachedTarget invoked from inside a setState updater (impure reducer) and as an effect dependency that restarts the RAF loop
**File:** `src/blobbi/companion/hooks/useBlobbiCompanionMotion.ts:117 (and dep array 133)`  ·  **Kind:** bug  ·  **Votes:** 2/3

**Why it's real:** Inside setMotion(prev => {... if (reachedTarget) { setTimeout(onReachedTarget, 0); } ...}) the updater performs a side effect. React may invoke state updater functions more than once (StrictMode/concurrent), so the target-reached callback can be scheduled multiple times for a single landing, causing duplicate state transitions in useBlobbiCompanionState. Additionally onReachedTarget is in the animate effect's dependency array (line 133); since that callback's identity changes whenever observationTarget/state change, the whole requestAnimationFrame loop is torn down and recreated mid-walk.

**Fix:** Don't call side effects inside the setState updater: detect reachedTarget, return the new motion, then fire onReachedTarget once outside the updater (e.g. via a ref flag checked after setMotion, or store latest onReachedTarget in a ref and call it in the animate body). Keep onReachedTarget out of the effect deps by reading it from a ref so the RAF loop is stable.

**Suggested issue: KUBO-NEW**

### 22. Item-reaction setTimeout not cancelled — can call onWalkTo/onGlance after unmount or when isActive flips false
**File:** `src/blobbi/companion/hooks/useCompanionItemReaction.ts:150-172`  ·  **Kind:** bug  ·  **Votes:** 2/3

**Why it's real:** reactToItemLanding schedules setTimeout(..., REACTION_CONFIG.reactionDelay) that later calls onWalkTo?.(position) / onGlance?.(position). There is no cleanup and no re-check of isActive inside the timeout. If the companion is removed or isActive becomes false during the 150ms delay, the callback still triggers attention/movement against a torn-down companion.

**Fix:** Store the timeout id in a ref, clear it in an unmount-cleanup useEffect, and re-check the latest isActive (via a ref) inside the timeout before invoking onWalkTo/onGlance.

**Suggested issue: KUBO-NEW**

### 23. Unused released-count state map adds churn without consumers
**File:** `src/blobbi/companion/interaction/HangingItems.tsx:407, 603, 672-679, 700-707, 936-941`  ·  **Kind:** cleanup  ·  **Votes:** 3/3

**Why it's real:** _releasedCountByItemId is declared (line 407, name prefixed _ to mark unused) yet its setter setReleasedCountByItemId is called on every release (936), every successful use (672, 700), and on close (603). These setState calls cause re-renders but the value is never read anywhere (the comment at 986-988 notes quantity filtering is gone). It is pure dead state that triggers extra renders.

**Fix:** Remove the _releasedCountByItemId state and all setReleasedCountByItemId calls; if a release count is needed later, derive it from releasedItems.

**Suggested issue: KUBO-NEW**

### 24. Optimistic cache write is immediately invalidated, and mutationFn invalidates again, fighting the read-modify-write design
**File:** `src/blobbi/companion/interaction/useBlobbiItemUse.ts:222-225, 380`  ·  **Kind:** quality  ·  **Votes:** 3/3

**Why it's real:** updateCompanionInCache does queryClient.setQueryData (optimistic, lines 200-220) then immediately queryClient.invalidateQueries(['blobbi-collection', user.pubkey]) (lines 223-225). The mutationFn also calls invalidateQueries at line 380 after updateCompanionInCache. Sibling hooks (useBlobbiSleepToggle.ts:74-78 comment, useBlobbisCollection.ts:165-167 comment) explicitly state invalidation is unnecessary after RMW and can refetch stale relay state over the fresh optimistic value. The double invalidation here can trigger a background refetch that briefly reverts the just-applied stats.

**Fix:** Drop the invalidateQueries calls (both inside updateCompanionInCache and at line 380) and rely on the optimistic setQueryData across all matching queries, matching the pattern already used in useBlobbiSleepToggle.updateCache.

**Suggested issue: KUBO-NEW**

### 25. getDaysDifference can under-count by one day across DST boundaries, corrupting care streak
**File:** `src/blobbi/core/lib/blobbi.ts:87-92`  ·  **Kind:** bug  ·  **Votes:** 3/3

**Why it's real:** parseLocalDayString builds local-midnight Date objects, then getDaysDifference does `Math.floor(Math.abs(ms) / 86_400_000)`. On a spring-forward DST day the wall-clock span between two consecutive calendar midnights is 23h, so Math.floor(23h/24h) === 0 — two distinct calendar days report a difference of 0. blobbi-streak.ts uses this for daysMissed / daysSinceLastActivity, so a streak update on the DST day can be mis-counted (no increment / wrong reset).

**Fix:** Compute the day difference on calendar components, not elapsed ms — e.g. use Date.UTC(year, month, day) for both parsed days before subtracting, or round instead of floor: `Math.round(diffMs / 86_400_000)`.

**Suggested issue: KUBO-NEW**

### 26. EggGraphic hexToHsl produces NaN colors for valid 3-digit (#RGB) hex base colors
**File:** `src/blobbi/egg/components/EggGraphic.tsx:249-252`  ·  **Kind:** bug  ·  **Votes:** 3/3

**Why it's real:** getBaseColor() accepts blobbi.baseColor / the 'base_color' tag when isValidBaseColor() passes, and isValidBaseColor (blobbi-egg-validation.ts:130) accepts 3-digit hex `#RGB`. hexToHsl then does `parseInt(hex.slice(5,7),16)` which on a 3-char hex like '#abc' yields parseInt('',16) === NaN, so r/g/b become NaN. createColorVariants' try/catch does NOT catch this (no exception is thrown — it silently yields '#NaNNaNNaN'), so createEggGradient renders a broken gradient. normalizeHexColor in blobbi.ts (line 639) likewise stores 3-digit colors, so this is reachable from persisted state.

**Fix:** Expand 3-digit hex to 6-digit at the top of hexToHsl (e.g. `if (hex.length === 4) hex = '#' + hex.slice(1).split('').map(c => c + c).join('');`), or tighten isValidBaseColor/normalizeHexColor to only accept 6-digit when feeding the gradient path.

**Suggested issue: KUBO-NEW**

### 27. handleDownload has no catch — native failure leaks the object URL and produces an unhandled rejection
**File:** `src/blobbi/ui/BlobbiPhotoModal.tsx:70-94`  ·  **Kind:** bug  ·  **Votes:** 3/3

**Why it's real:** handleDownload uses try/finally with NO catch. On the native path it does `const url = URL.createObjectURL(blob); await openUrl(url); URL.revokeObjectURL(url);` (lines 80-82). If `dataUrlToFile`/`atob` (malformed dataUrl) or `openUrl` throws, execution jumps to `finally` (which only flips isDownloading) and the error propagates as an unhandled promise rejection — the user sees no error toast (unlike handleShare which does catch and toast), and crucially `URL.revokeObjectURL(url)` is skipped, leaking the blob URL for the app lifetime. The success toast on line 90 is correctly skipped, but the failure is silently swallowed at the UI level.

**Fix:** Wrap the body in a catch that toasts an error (mirroring handleShare lines 121-123), and revoke the object URL in a finally / before rethrowing so it is freed even when openUrl throws.

**Suggested issue: KUBO-NEW**

### 28. MissionSurfaceCard.handleCycle schedules timers inside setTimeout that survive unmount
**File:** `src/blobbi/ui/components/MissionSurfaceCard.tsx:172-189`  ·  **Kind:** quality  ·  **Votes:** 3/3

**Why it's real:** handleCycle clears the current interval, then inside a 150ms setTimeout it both calls setActiveIndex and creates a NEW setInterval stored in timerRef.current (lines 177-188). The only cleanup is the auto-rotate effect's return clearing timerRef.current (line 167), which runs at unmount BEFORE this delayed callback fires. If the component unmounts during the 150ms window (e.g. modal closes right after a tap), the setTimeout still runs, calls setState on an unmounted component, and installs a fresh setInterval that nothing ever clears — a leaked recurring timer firing setState forever.

**Fix:** Track the inner setTimeout id in a ref and clear it in the cleanup, or refactor to a single declarative auto-rotate effect that resets on activeIndex change rather than imperatively re-arming nested timers; guard the delayed callback against running after unmount.

**Suggested issue: KUBO-NEW**

### 29. injectIntoEyeTrackLayer fallback never takes effect — silently drops eye effects on alternate class order
**File:** `src/blobbi/ui/lib/eyes/injection.ts:51-72`  ·  **Kind:** bug  ·  **Votes:** 2/3

**Why it's real:** When the primary lookup fails (gazeGroupStart === -1), the fallback block computes `altStart` but never assigns it back to `gazeGroupStart`. Execution falls through to line 59 with gazeGroupStart still -1; `svgText.lastIndexOf('<g', -1)` returns -1, so the function returns the unmodified svgText. The fallback path (alternate `class="blobbi-eye-gaze-{side}..."` ordering) is therefore dead code: any SVG whose gaze group uses a different class attribute ordering than the exact `class="blobbi-eye-gaze blobbi-eye-gaze-{side}"` string gets its sad-highlight / star-pupil injection silently skipped, with no error.

**Fix:** Assign the fallback offset into the working variable, e.g. `let gazeGroupStart = svgText.indexOf(...); if (gazeGroupStart === -1) { gazeGroupStart = svgText.indexOf(\`class=\"${EYE_CLASSES.gaze}-${side}\`); if (gazeGroupStart === -1) return svgText; }` so the subsequent lastIndexOf/indexOf use the fallback index.

**Suggested issue: KUBO-NEW**

### 30. lightenColor/darkenColor produce wrong output for 3-digit hex colors
**File:** `src/blobbi/ui/lib/svg/colors.ts:18-58`  ·  **Kind:** bug  ·  **Votes:** 2/3

**Why it's real:** Both functions do `parseInt(color.slice(1), 16)` then bit-shift assuming a 6-hex-digit (24-bit) integer. A 3-digit shorthand like `#fff` parses to 0xFFF (4095); `(4095>>16)` = 0 for R, so the channel decomposition is garbage and the returned color is wrong rather than a lightened/darkened white. The `startsWith('#')` guard passes shorthand through to this broken path.

**Fix:** Normalize shorthand to 6 digits before parsing (expand each nibble), or guard `if (color.length !== 7) return color;` so only full 6-digit hex is processed.

**Suggested issue: KUBO-NEW**

### 31. kind-1 comment query omits voice replies (kind 1222/1244)
**File:** `src/components/CommentsSheet.tsx:42-49`  ·  **Kind:** bug  ·  **Votes:** 3/3

**Why it's real:** useEventComments builds filters for kind-1 targets as `[{ kinds: [1, 1111], '#e': [event.id] }, { kinds: [1111], '#E': [event.id] }]`, and the addressable branch queries `[1111, 1244]`. Voice replies authored via this same ComposeBox are published as kind 1222 (root) / 1244 (NIP-22 reply). A voice reply to a kind-1 note (published as kind 1222 with an `e`/`reply` tag, lines 740-756) is never matched by `kinds: [1, 1111]`, so the user's own voice reply silently never appears in the Comments sheet.

**Fix:** Include 1222/1244 in the comment query kinds for kind-1 (and event) targets, e.g. `kinds: [1, 1111, 1222, 1244]` for the `#e` filter.

**Suggested issue: KUBO-NEW**

### 32. Comment row renders raw shortcodes/markdown instead of NoteContent
**File:** `src/components/CommentsSheet.tsx:96-98`  ·  **Kind:** quality  ·  **Votes:** 3/3

**Why it's real:** CommentRow renders `{event.content}` directly inside a <p>. Comments posted through this app's own ComposeBox can contain nostr: mentions, custom-emoji `:shortcode:` tokens, media URLs, and quote URIs. Displaying the raw string shows e.g. `:partyparrot:` literally and bare `nostr:nevent1...` strings, inconsistent with every other surface that uses NoteContent.

**Fix:** Render the comment body via `<NoteContent event={event} />` (or at minimum emojify) instead of the raw `event.content` string.

**Suggested issue: KUBO-NEW**

### 33. Unguarded JSON.parse of localStorage crashes ContentSettings on corrupt data
**File:** `src/components/ContentSettings.tsx:254-257`  ·  **Kind:** bug  ·  **Votes:** 3/3

**Why it's real:** The `community` useState initializer does `const stored = localStorage.getItem(getStorageKey(config.appId, 'community')); return stored ? JSON.parse(stored) : null;` with no try/catch. If the stored value is ever truncated or corrupted (partial write, manual edit, storage-quota truncation), `JSON.parse` throws synchronously during render and takes down the entire ContentSettings page (settings become inaccessible). Every other localStorage read in this same file is either a plain string or guarded; this one is not.

**Fix:** Wrap the parse in try/catch and fall back to null: `try { return stored ? JSON.parse(stored) : null; } catch { return null; }`.

**Suggested issue: KUBO-NEW**

### 34. GeocacheContent renders NaN for non-numeric D/T tags
**File:** `src/components/GeocacheContent.tsx:59-60`  ·  **Kind:** quality  ·  **Votes:** 3/3

**Why it's real:** `const difficulty = Number(getTag(event.tags, 'D') ?? 1)`. If the `D`/`T` tag is present but non-numeric (attacker- or buggy-client-controlled), Number(...) yields NaN. DifficultyPips renders 0 filled pips (`i < NaN` is always false) and the label shows the literal text "NaN" via `{difficulty}` at lines 114/120.

**Fix:** Guard: `const d = Number(getTag(...)); const difficulty = Number.isFinite(d) ? Math.min(5, Math.max(1, d)) : 1;` (same for terrain), so malformed tags fall back to 1 instead of NaN.

**Suggested issue: KUBO-NEW**

### 35. Partial badge-award failure clears the whole selection
**File:** `src/components/GiveBadgeDialog.tsx:153`  ·  **Kind:** quality  ·  **Votes:** 3/3

**Why it's real:** handleSend awards each selected badge in a loop, collecting `succeeded`/`failed`. On a partial failure it keeps the dialog open and shows a 'Please try again.' toast, but unconditionally runs `setSelectedATags(new Set())`, wiping the selection for the badges that failed too. The user must re-locate and re-tick the failed badges to retry.

**Fix:** On partial failure, retain only the failed items in the selection, e.g. set selection to the aTags of `toAward` whose name is in `failed`; only clear fully when `failed.length === 0`.

**Suggested issue: KUBO-NEW**

### 36. MediaCollage video thumbnails autoplay full-resolution video for every tile
**File:** `src/components/MediaCollage.tsx:159-170`  ·  **Kind:** perf  ·  **Votes:** 3/3

**Why it's real:** Every video item in the collage renders a `<video src={item.url} autoPlay loop muted>` with `preload="metadata"`. In a justified collage of many events this starts decoding/playing N videos simultaneously off their original source URLs (no poster/thumbnail substitution), which on mobile (the primary Kubo target) causes heavy memory/CPU/bandwidth use and can stall the feed.

**Fix:** Render a static poster (first-frame/blurhash) for the grid tile and only autoplay on hover/intersection, or cap the number of concurrently autoplaying videos. Defer actual playback to the Lightbox.

**Suggested issue: KUBO-NEW**

### 37. MentionAutocomplete keydown effect captures a stale selectProfile (stale mentionStart) → mention inserted at wrong offset
**File:** `src/components/MentionAutocomplete.tsx:200-232`  ·  **Kind:** bug  ·  **Votes:** 3/3

**Why it's real:** The keyboard-navigation effect calls `selectProfile(profiles[selectedIndex])` on Enter/Tab but its dependency array (line 232) is `[isOpen, profiles, selectedIndex, textareaRef]` with an eslint-disable for exhaustive-deps; it omits `selectProfile`, which itself closes over `mentionStart` and `mentionQuery`. selectProfile is recreated whenever mentionStart/mentionQuery change, but the effect only re-binds the listener when selectedIndex/profiles change. If the user moves the caret (changing mentionStart) without changing the result set, the bound handler can call an old selectProfile and replace text using a stale `start` offset, corrupting the composed note.

**Fix:** Add `selectProfile` to the effect deps (it is already useCallback-memoized on mentionStart/mentionQuery) and remove the eslint-disable, so the keydown listener always references the current insertion offsets.

**Suggested issue: KUBO-NEW**

### 38. Bunker signer resolved before NPool exists; comment about useMemo timing is wrong and memo never re-runs
**File:** `src/components/NostrProvider.tsx:73-96`  ·  **Kind:** bug  ·  **Votes:** 3/3

**Why it's real:** signerFromLogin() for a bunker login calls `NUser.fromBunkerLogin(login, pool.current!)`. The justifying comment claims 'pool.current is guaranteed to exist here: the pool is created synchronously during the first render (below), and useMemo runs after the render body has executed.' That is incorrect: the `currentSigner = useMemo(...)` at line 92 executes inline at its position during render, which is BEFORE the `if (!pool.current) { pool.current = new NPool(...) }` block at line 157. On a cold start where a bunker login is already present, pool.current is undefined, the `!` assertion hides it, the try/catch swallows the resulting throw and returns undefined. Because the memo deps are `[currentLogin]` and currentLogin is stable, the memo will not recompute on the next render, so the bunker user can be left with no active signer for the session (until the provider remounts).

**Fix:** Create the NPool before deriving signers (move pool initialization above the useMemo, or lazily init it inside signerFromLogin), and/or add pool.current as a memo dependency / a state flag that flips once the pool exists so the signer memo recomputes once the pool is ready. Remove the inaccurate timing comment.

**Suggested issue: KUBO-NEW**

### 39. State mutation inside useMemo (side-effect in render) in PollVotersModal
**File:** `src/components/PollContent.tsx:349-352`  ·  **Kind:** quality  ·  **Votes:** 3/3

**Why it's real:** `useMemo(() => { if (open) setActiveFilter(initialOptionId ?? null); }, [open, initialOptionId])` calls a state setter from within useMemo. useMemo must be pure; React may skip/re-run it, and calling setState during render is an anti-pattern that can trigger extra renders or be dropped under StrictMode/concurrent rendering, leaving the voter filter out of sync with the option the user clicked.

**Fix:** Replace the useMemo with a useEffect that runs the same `if (open) setActiveFilter(initialOptionId ?? null)` on [open, initialOptionId].

**Suggested issue: KUBO-NEW**

### 40. Unreact deletes only one of possibly several kind-7 reaction events
**File:** `src/components/ReactionButton.tsx:60-69`  ·  **Kind:** bug  ·  **Votes:** 3/3

**Why it's real:** handleUnreact queries kind 7 authored by the user with '#e':[eventId] and limit:1, then deletes only events[0].id. If the user previously published more than one reaction to the same event (e.g. emoji then heart, or a duplicate from another client), only one kind-7 is deleted; the optimistic count drops by one but stale reactions remain on relays and reappear after the 3s invalidation.

**Fix:** Drop the limit:1, collect all matching reaction event IDs for the user on this target, and issue a kind-5 deletion covering all of them (or at least the most recent set).

**Suggested issue: KUBO-NEW**

### 41. TeamSoapboxCard 'added' count is computed from freshly-fetched kind 3 but the button's 'Already following all' state uses the stale cached followList
**File:** `src/components/TeamSoapboxCard.tsx:74`  ·  **Kind:** quality  ·  **Votes:** 3/3

**Why it's real:** newPubkeys (used to show 'Already following all') derives from `useFollowList()` cache, while handleFollowAll fetches a fresh kind 3 via fetchFreshEvent and computes `added` from that. If the cached followList is stale/empty, the button can show 'Follow All (N)' yet the publish adds 0 (toast says 'already following everyone'), or vice versa — the displayed count and the actual merge disagree. Not data loss (merge logic is correct), but the UI count is misleading.

**Fix:** Either drive the button label from the same fresh fetch, or invalidate/refresh the follow list query after publish so the cached followList and the published list stay consistent.

**Suggested issue: KUBO-NEW**

### 42. ThemeSelector publishes a theme with a fabricated empty event object in editingTheme
**File:** `src/components/ThemeSelector.tsx:603`  ·  **Kind:** quality  ·  **Votes:** 3/3

**Why it's real:** In handlePublishSubmit, after a successful publish the new editingTheme is built with `event: {} as ThemeDefinition['event']` — a cast-away empty object with no id/pubkey/kind/sig. Any later code that reads editingTheme.event (e.g. delete/republish flows expecting a real event) would operate on a malformed event. handleUpdateTheme republishes by identifier so it currently survives, but the fake event is a latent footgun if deleteTheme/other consumers ever dereference event fields.

**Fix:** Have publishTheme return the actual signed NostrEvent (or refetch it) and store the real event in editingTheme, instead of casting `{}`. Alternatively make editingTheme.event optional and guard all consumers.

**Suggested issue: KUBO-NEW**

### 43. video.play() promises are not caught, producing unhandled promise rejections
**File:** `src/components/VideoPlayer.tsx:167-200`  ·  **Kind:** quality  ·  **Votes:** 3/3

**Why it's real:** togglePlay (line 168 `video.play()`) and handleVideoClick first-play path (line 197 `if (video) video.play()`) call HTMLMediaElement.play() without a .catch(). play() returns a Promise that rejects when playback is blocked by autoplay policy or interrupted by a near-simultaneous pause()/load(). The Media Session handler at line 128 already guards this with `.catch(() => {})`, so the omission here is inconsistent and surfaces as console 'Uncaught (in promise) NotAllowedError/AbortError' on user devices.

**Fix:** Append `.catch(() => {})` to the video.play() calls in togglePlay and handleVideoClick, matching the Media Session play handler.

**Suggested issue: KUBO-NEW**

### 44. Re-selecting the same .xdc file after "Change" silently does nothing (file input value never reset)
**File:** `src/components/WebxdcUploadDialog.tsx:182-211`  ·  **Kind:** bug  ·  **Votes:** 3/3

**Why it's real:** The "Change" button calls reset() (which sets file=null) then fileInputRef.current?.click(). The hidden <input type="file" ... onChange={handleFileSelect}> at lines 205-211 never has its value cleared. Browsers do not fire the change event when the user re-picks the exact same file that is still in input.value, so handleFileSelect never runs, file stays null, and the dialog is stuck showing the empty picker even though the user just chose a file. Same applies after reset() on dialog close/reopen within the same mount.

**Fix:** Clear the input value before/after opening the picker, e.g. in handleFileSelect set e.target.value = '' at the end, or in the Change onClick do `if (fileInputRef.current) fileInputRef.current.value = ''` before calling click().

**Suggested issue: KUBO-NEW**

### 45. Auto-scroll ignores new system events
**File:** `src/components/groups/GroupChatTab.tsx:79-83`  ·  **Kind:** bug  ·  **Votes:** 3/3

**Why it's real:** The scroll-to-bottom effect depends only on `messages.length` (`}, [messages.length]);`). System rows (joined/left/added/removed from `useGroupSystemEvents`) are interleaved into `grouped` and rendered at the bottom, but when a system event arrives without an accompanying chat message, `messages.length` is unchanged, so the effect does not fire and the newly appended system row stays below the fold.

**Fix:** Add `systemEvents.length` to the effect dependency array: `}, [messages.length, systemEvents.length]);` so membership-change rows also pin the view to the bottom.

**Suggested issue: KUBO-NEW**

### 46. useFormField guard is dead code and runs getFieldState before the null check
**File:** `src/components/ui/form-utils.ts:32-36`  ·  **Kind:** quality  ·  **Votes:** 3/3

**Why it's real:** getFieldState(fieldContext.name, formState) is called at line 32 BEFORE the `if (!fieldContext) throw ...` guard at line 34. Because FormFieldContext is created with a default value of `{} as FormFieldContextValue` (line 15-17), fieldContext is never null/undefined, so the guard at line 34 is permanently dead code. When useFormField is mistakenly used outside a <FormField>, instead of throwing the intended descriptive error it calls getFieldState(undefined, formState), producing a confusing internal react-hook-form error.

**Fix:** Move the guard before getFieldState and check the actual failure condition, e.g. `if (!fieldContext.name) throw new Error('useFormField should be used within <FormField>')` placed above the getFieldState call.

**Suggested issue: KUBO-NEW**

### 47. MenubarShortcut.displayName typo (lowercase 'n') leaves component nameless
**File:** `src/components/ui/menubar.tsx:215`  ·  **Kind:** quality  ·  **Votes:** 3/3

**Why it's real:** Line 215 assigns `MenubarShortcut.displayname = "MenubarShortcut"` with a lowercase 'n'. React reads `displayName` (capital N), so this assignment has no effect and the component renders as anonymous in devtools/error overlays. (Note: menubar is not imported anywhere in src, so impact is nil today, but the typo is a latent defect if it ever gets used.)

**Fix:** Rename to `MenubarShortcut.displayName = "MenubarShortcut"`.

**Suggested issue: KUBO-NEW**

### 48. AIChatWidget caches conversation under empty-string key, leaking one user's chat to the logged-out/next state
**File:** `src/components/widgets/AIChatWidget.tsx:41-51`  ·  **Kind:** bug  ·  **Votes:** 3/3

**Why it's real:** cacheKey = user?.pubkey ?? ''. The write-back effect guards `if (cacheKey)`, but the initial useState reads `conversationCache.get(cacheKey) ?? []` unconditionally. The render gate `if (!user || !isAuthenticated)` prevents display while logged out, but on a fast pubkey switch the messages state is seeded once from the initial cacheKey and is not re-seeded when cacheKey changes (useState initializer runs once), so switching accounts within the same mount keeps the previous user's messages in state until remount.

**Fix:** Re-seed messages on cacheKey change (e.g. an effect that setMessages(conversationCache.get(cacheKey) ?? []) when cacheKey changes), and skip the read entirely when cacheKey is ''.

**Suggested issue: KUBO-NEW**

### 49. Widget feed queries omit the actual author pubkey list from the React Query key, serving stale cross-list data
**File:** `src/components/widgets/FeedWidget.tsx:50-58`  ·  **Kind:** bug  ·  **Votes:** 3/3

**Why it's real:** queryKey is ['widget-feed', kindsKey, authorsKey, limit] where authorsKey is only 'follows' | 'curator'. The actual `authors` array (followPubkeys or curatorFollows) is NOT in the key. If the user follows/unfollows accounts (followPubkeys changes) the cached query under key 'follows' is not invalidated, so the widget keeps querying with the originally-cached results until staleTime (5m) expires AND a refetch occurs. Same pattern in MusicWidget.tsx (line 36-37) and PhotoWidget.tsx (line 48-49) keyed only by authorsKey.

**Fix:** Include a stable hash/length of the authors array in the queryKey, e.g. add `authors?.length ?? 0` or a joined-pubkey digest so follow-list changes bust the cache.

**Suggested issue: KUBO-NEW**

### 50. AudioPlayer ended/seek handlers stale due to missing currentTime/duration deps causing setPositionState desync after track auto-advance
**File:** `src/contexts/AudioPlayerContext.tsx:43-53`  ·  **Kind:** bug  ·  **Votes:** 3/3

**Why it's real:** onEnded auto-advances by setting audio.src and calling play(), but does NOT reset setCurrentTime(0)/setDuration(...) the way nextTrack()/mediaSession 'nexttrack' do (lines 121-125, 131-134). After natural track-end advance, currentTime/duration state retains the previous track's values until timeupdate/durationchange fire, so the floating bar scrubber and OS mediaSession.setPositionState briefly report the old position/duration for the new track.

**Fix:** In onEnded's auto-advance branch, mirror nextTrack(): setCurrentTime(0) and setDuration(playlist[next].duration ?? 0) before/after setting audio.src.

**Suggested issue: KUBO-NEW**

### 51. beforeunload handler blocks page unload whenever a track is loaded, even when paused/stopped-mid-load
**File:** `src/contexts/AudioPlayerContext.tsx:150-157`  ·  **Kind:** quality  ·  **Votes:** 3/3

**Why it's real:** The effect registers a beforeunload preventDefault for the whole lifetime of `currentTrack` being non-null (dep [currentTrack]). It does not check isPlaying, so after the user pauses, navigating away still triggers the browser's 'Leave site?' confirmation prompt even though nothing is playing.

**Fix:** Gate the handler on isPlaying (add isPlaying to deps and `if (!currentTrack || !isPlaying) return;`) so the unload guard only applies during active playback.

**Suggested issue: KUBO-NEW**

### 52. useArchiveSearch interpolates raw user input into a Lucene query
**File:** `src/hooks/useArchiveSearch.ts:33`  ·  **Kind:** bug  ·  **Votes:** 3/3

**Why it's real:** `const q = \`title:(${query}) mediatype:(...)\`` interpolates the raw user query into an archive.org Lucene query string before encodeURIComponent. A query containing Lucene metacharacters (e.g. an unbalanced `)`, `AND`, `:`, `OR`) breaks out of the title:( … ) clause or corrupts the syntax, yielding wrong/empty results or a 400 from advancedsearch.php (which the `if (!response.ok) return []` then silently swallows as 'no results').

**Fix:** Escape or strip Lucene special characters from `query` (e.g. backslash-escape `+ - && || ! ( ) { } [ ] ^ " ~ * ? : \\ /` or quote the term as a phrase) before building the title:() clause.

**Suggested issue: KUBO-NEW**

### 53. useBlueskySearch crashes whole result set on a post missing record.text
**File:** `src/hooks/useBlueskySearch.ts:90`  ·  **Kind:** bug  ·  **Votes:** 2/3

**Why it's real:** In searchBluesky's map, `text: post.record.text.slice(0, 200)` accesses record.text unconditionally. The Bluesky public searchPosts API can return posts whose record lacks a `text` field (or record is absent on tombstoned/blocked records), making `post.record.text` undefined; `.slice()` on undefined throws a TypeError inside the queryFn, rejecting the entire query so NO results render — not just the offending post. The sibling hook useBlueskyPost.ts (line 91) defensively uses `post.record.text ?? ''`, showing the field is known to be optional. `likes: post.likeCount` (line 92) has the same unguarded-undefined risk.

**Fix:** Guard the fields: `text: (post.record?.text ?? '').slice(0, 200)` and `likes: post.likeCount ?? 0`, mirroring useBlueskyPost.ts. Optionally filter out posts whose record is missing before mapping.

**Suggested issue: KUBO-NEW**

### 54. Cross-tab storage listener re-subscribes on every render when a serializer is passed inline
**File:** `src/hooks/useLocalStorage.ts:67-80`  ·  **Kind:** quality  ·  **Votes:** 2/3

**Why it's real:** The storage-event effect lists `deserialize` in its dependency array (line 80). `deserialize` is `serializer?.deserialize`; callers that pass an inline `serializer={{ serialize, deserialize }}` object create a fresh function identity every render, so the effect tears down and re-adds the window 'storage' listener on each render, and a storage event firing mid-render can momentarily have no listener attached.

**Fix:** Drop `deserialize` from the dep array (it is only invoked, not identity-significant) and keep `[key]`, or memoize/ref the serializer so the listener is registered once per key.

**Suggested issue: KUBO-NEW**

### 55. addConnection's connection 'test' never actually contacts the wallet, so isConnected is always true
**File:** `src/hooks/useNWC.ts:72-119`  ·  **Kind:** bug  ·  **Votes:** 3/3

**Why it's real:** The 'connection test' only does `new LN(parsed.connectionString)` and resolves immediately (lines 74-87); constructing the client does no network round-trip. The 10s timeout can therefore never fire for a bad-but-well-formed NWC URI, and the connection is stored with isConnected:true and a hardcoded methods:['pay_invoice'] (lines 94-106) regardless of whether the wallet relay is reachable or supports paying. Users get a 'Wallet connected' success toast for unreachable/invalid wallets, and the failure only surfaces later at payment time.

**Fix:** Perform a real liveness/capability check (e.g. fetch wallet info / get_info via the SDK) inside testPromise so the timeout and catch path are meaningful, and set isConnected/methods from the actual response.

**Suggested issue: KUBO-NEW**

### 56. markAsRead closes over stale `items` (dep array uses items.length, not items)
**File:** `src/hooks/useNotifications.ts:403-440`  ·  **Kind:** bug  ·  **Votes:** 2/3

**Why it's real:** markAsRead computes `Math.max(...items.map(item => item.event.created_at))` over the `items` array, but its useCallback dependency list is `[user?.pubkey, items.length, notificationsCursor]`. When the newest notification changes without the array length changing (e.g. a new event arrives while an equal number of older events drop out of the window, common with pagination/dedup), the memoized callback keeps the previous `items` closure and writes an out-of-date `newestTimestamp` cursor — marking the wrong set as read, potentially leaving genuinely new notifications flagged unread or marking unseen ones read.

**Fix:** Include `items` (or a derived newest-timestamp value) in the dependency array, or read the newest timestamp from a ref kept in sync with `items`, so markAsRead always uses the current newest event.

**Suggested issue: KUBO-NEW**

### 57. usePersistentNostrSession is dead code referencing non-Kubo (Blobbi) query keys
**File:** `src/hooks/usePersistentNostrSession.ts:135-142, 257-264`  ·  **Kind:** cleanup  ·  **Votes:** 3/3

**Why it's real:** grep shows zero importers of usePersistentNostrSession anywhere under src/. The hook hard-codes invalidation of `['blobbonaut-profile']` and `['blobbi-companion']` query keys (Blobbi game), not Kubo feed/profile keys, so even if wired up it would refresh the wrong caches. It is inherited/unused code carrying the reconnect-state bug above.

**Fix:** Delete the hook (or, if a persistent-session indicator is actually wanted, rewrite it to invalidate real Kubo query keys and wire it into the app).

**Suggested issue: KUBO-NEW**

### 58. useVoiceRecorder.startRecording leaves no cleanup path if AudioContext/MediaRecorder setup throws after stream acquired
**File:** `src/hooks/useVoiceRecorder.ts:118-133`  ·  **Kind:** bug  ·  **Votes:** 3/3

**Why it's real:** After `getUserMedia` succeeds and `streamRef.current = stream` is set (line 118-119), the subsequent `new AudioContext()`, `createMediaStreamSource`, or `new MediaRecorder(stream, { mimeType })` (line 122-132) can throw (e.g. unsupported mimeType on some Android WebViews despite isTypeSupported quirks). The throw propagates out of startRecording with isRecording still false but the microphone stream/tracks left running (no stop), leaving the mic indicator on until unmount cleanup.

**Fix:** Wrap the setup from line 122 onward in try/catch and call cleanup() on failure before rethrowing, so the acquired MediaStream tracks are stopped if recorder/analyser construction fails.

**Suggested issue: KUBO-NEW**

### 59. useWebxdc.sendUpdate invalidates query before the event is actually published (logged-in path)
**File:** `src/hooks/useWebxdc.ts:23, 121-130, 141-151`  ·  **Kind:** bug  ·  **Votes:** 3/3

**Why it's real:** publishEvent is destructured as `mutate` (line 23: `const { mutate: publishEvent } = useNostrPublish()`), which returns void synchronously, not a Promise. In the logged-in branch of publishSigned (line 124 `if (user) { publishEvent(template); }`) nothing is awaited, so the async publishSigned resolves immediately. sendUpdate's `.then(() => queryClient.invalidateQueries(...))` (line 146-148) therefore fires the refetch before the kind-4932 event has reached any relay. The just-sent update can be missing from the refetched list, so the local serial counter / listener delivery is racy for the sender's own updates.

**Fix:** Use the async form: destructure `mutateAsync` (or call `await publishEvent.mutateAsync(template)`) in the logged-in branch of publishSigned so the .then() invalidate runs only after the publish promise resolves.

**Suggested issue: KUBO-NEW**
