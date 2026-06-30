# Kubo — Google Play publishing runbook

Tooling to publish Kubo to Google Play **up to the human release gate**, under the **Web of
Trust Foundation (WOTF)** developer account. Mirrors Yenn's `yenn/services/deploy/publish-play.py`.
The hard rule: an agent may build, upload to **test tracks**, and edit **listing metadata**
autonomously, but must **stop before** promoting to production / submitting for review.

## ⚠️ PLAY PACKAGE = `watch.kubo.app` (NOT com.kubo.app)

`com.kubo.app` is taken on Google Play by an unrelated developer (many third-party "Kubo" apps
exist). The Play build therefore uses **`watch.kubo.app`** (reverse-DNS of kubo.watch).
**Zapstore + GitHub releases keep `com.kubo.app`** — a different channel with a different
applicationId, untouched. The split is opt-in: the publish tooling passes
`-PplayApplicationId=watch.kubo.app` to gradle (a `hasProperty` override in
`android/app/build.gradle` that defaults to `com.kubo.app`), so the Zapstore lineage is unaffected.
Both can ship from the same commit/versionCode. (Play App Signing already splits the certs between
channels — see cross-signer note — so cross-channel in-place updates weren't possible anyway.)

## Account & auth

- **Developer account:** Web of Trust Foundation (WOTF).
- **GCloud project:** `kubo-play-publish` (project number 874703806274), Play Developer API enabled.
- **Service account:** `kubo-play-publisher@kubo-play-publish.iam.gserviceaccount.com`
- **Key:** `kubo/play-store/play-service-account.json` (gitignored; NEVER commit).
- **Permission grant:** done in Play Console → Users and permissions → Invite new users
  (paste the SA email). Granted: view app info, create/edit/delete draft apps, release to
  testing tracks + production, manage testing tracks, edit tester lists, manage deep links,
  manage policy declarations, Android developer verification. Status: active.
## FIRST AAB must be uploaded via the Console (one-time)

The app record `watch.kubo.app` EXISTS under WOTF (created 2026-06-30) and `status` returns all
4 tracks (empty). The only remaining one-time human step: **upload the first AAB via the Console
UI** — the API cannot create a brand-new app's *first* release.

1. Build the first signed AAB: `python3 publish-play.py upload --track internal` builds it
   (with `applicationId=watch.kubo.app`) but will fail at the upload step for the first release;
   the built AAB is at `kubo/android/app/build/outputs/bundle/release/app-release.aab`.
2. In Play Console → Testing → Internal testing → **Create new release**, drag that AAB in.
   **Accept Play App Signing** on this first upload (see cross-signer note below).
3. After that, `python3 publish-play.py status` shows the release and **all subsequent API
   uploads/listing edits work** via `upload --track …` and `listing-push`.

## Build (Capacitor + npm + Vite — NOT Flutter)

`publish-play.py upload` runs this automatically; here it is for reference:

```
npm ci
npx vite build -l error && cp dist/index.html dist/404.html
npx cap sync android && node scripts/patch-cap-config.mjs
cd android && ./gradlew bundleRelease --no-daemon
```

- **Env:** `JAVA_HOME` (JDK 21 via sdkman), `ANDROID_HOME=$HOME/Android/Sdk`. The script sets these.
- **Output AAB:** `kubo/android/app/build/outputs/bundle/release/app-release.aab`
- **Signing:** `android/key.properties` → `android/app/kubo-release.keystore` (alias `kubo-release`).
  The script **verifies the signing cert** (pinned SHA-256 `3A:99:7F…7CC8`) and aborts if the
  build fell back to the debug key.

## versionCode (CalVer — must be bumped before each upload)

- Current: `versionCode 2026062300`, `versionName "2026.06.23"` (android/app/build.gradle).
- Play requires a **strictly greater** versionCode than anything already uploaded. **Run
  `status` first** — it prints the live max versionCode and your local one.
- To bump (manual, outside the script — it never mutates tracked source):
  - `android/app/build.gradle`: `versionCode YYYYMMDD00`, `versionName "YYYY.MM.DD"`
  - `package.json`: `"version": "YYYY.MM.DD"`
  - same-day rebuild → `…01`, `…02`.
- The script's `upload` preflight **warns** if local ≤ live max (so a forgotten bump is caught
  before the API rejects it).

## Commands

```bash
cd kubo/play-store
python3 publish-play.py status                              # live tracks + versionCodes (run FIRST)
python3 publish-play.py upload --track internal             # build + upload to internal
python3 publish-play.py upload --track beta --no-build      # upload existing AAB to beta
python3 publish-play.py upload --track production --i-understand-this-is-production
python3 publish-play.py listing-diff                        # local-vs-live listing diff
python3 publish-play.py listing-push --confirm              # push listing edits (gated)
```

- **Track is never defaulted** — `upload` refuses without `--track`. ALWAYS confirm the track
  with the user first (workspace rule).
- **production is double-gated** — needs `--track production` AND
  `--i-understand-this-is-production`, and even then lands as a 0%-rollout DRAFT a human starts.

## Store listing

Source of truth: `kubo/play-store/play-listing/en-US/` (title/short/full `.txt` + `icon/`,
`featureGraphic/`, `phoneScreenshots/`). Seeded from `docs/google-play-publish.md` + the
existing `play-store/` assets. `listing-diff` / `listing-push --confirm` keep it in sync.

## Human-gated (Console, NOT scripted) — preconditions for production review

- **Play App Signing:** accept on first upload (our keystore becomes the *upload* key; Google
  holds the *app-signing* key). One-time, irreversible. Means Play APK and Zapstore APK have
  different signing certs — no cross-channel in-place updates.
- **Target audience: 18+ ONLY.** Do NOT tick under-18 (would force "Designed for Families",
  rejected for v1). Kubo is framed as a *parent's tool* on a supervised device.
- **Content rating (IARC):** Reference/Educational; No to violence/sexual/etc.; **Yes** to
  user-generated/online content (Nostr UGC). Expect Teen/Mature — do not game to "Everyone".
- **Data Safety:** minimal collection, encrypted in transit, deletion partial (NIP-09).
  Plausible analytics is bundled but config-gated (`plausibleDomain: ""` → off in prod). If
  that is ever set non-empty, revisit the Data Safety declaration.
- **Privacy policy URL:** `https://kubo.watch/privacy` must be live before review.
- **Store category:** Parenting.

## Kubo-specific cautions

- Commit policy: Kubo commits go to `brand/main`; only touch `kubo/`. The publish tooling +
  listing live under `kubo/play-store/`.
- `.gitlab-ci.yml` stamps versionCode from CI in CI runs — do NOT run a CI publish job after a
  manual upload, or codes diverge. Manual upload and CI publish are mutually exclusive per release.
- Package is `com.kubo.app` (NOT the upstream Ditto `pub.ditto.app` some docs reference).
