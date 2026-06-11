/**
 * KUBO-182 — pure resolution of the device-local `featureTepp` *mirror* value
 * when the active session is a kid and we are merging that kid's synced
 * kind-30078 feedSettings into the local config.
 *
 * Background: per KUBO-152, `config.feedSettings.featureTepp` is only a
 * parent-UI/sync mirror — enforcement reads `family.teppEnforced`. NostrSync
 * therefore SKIPS the kid's synced `featureTepp` so a kid can't author the
 * mirror. But it still has to decide what the mirror should be after the merge.
 *
 * The bug this fixes: the old logic was `currentMirror ?? false`. On a device
 * where the parent never touched the TEPP toggle, the persisted mirror has no
 * `featureTepp` key at all (`undefined`) — the `true` comes purely from the
 * app-wide default in AppProvider's deep-merge. The moment a freshly-added 2nd
 * or 3rd kid became the active session (their seeded settings omit
 * `featureTepp`), this wrote `false` into the device-local mirror, contradicting
 * the KUBO-150/151 default-ON intent and hiding the Trust → Diagnostics link
 * even though TEPP was still enforced for the family.
 *
 * Resolution order:
 *   1. an explicitly-persisted mirror value wins (parent's deliberate choice),
 *   2. otherwise fall back to the app-wide default (the deep-merged
 *      `config.feedSettings.featureTepp`, which is `true` by default).
 *
 * The kid's own synced value is never consulted here — that's the whole point
 * of skipping it in the merge.
 *
 * @param persistedMirror  `current.feedSettings.featureTepp` from the persisted
 *   (partial) config — `undefined` when the parent never set it on this device.
 * @param appDefault  the deep-merged `config.feedSettings.featureTepp`, i.e. the
 *   app-wide default-ON value when nothing overrides it.
 */
export function resolveKidActiveFeatureTeppMirror(
  persistedMirror: boolean | undefined,
  appDefault: boolean,
): boolean {
  return persistedMirror ?? appDefault;
}
