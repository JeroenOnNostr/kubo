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
