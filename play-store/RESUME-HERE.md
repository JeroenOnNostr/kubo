# Kubo Google Play — RESUME HERE

Snapshot of where the Play submission stands, so it can be picked up cold. Last updated
**2026-06-30**. App: **Kubo**, Play package **`watch.kubo.app`**, account **Web of Trust
Foundation (organization)**. Full form answers: `CONSOLE-ANSWER-SHEET.md` (in this dir).

## ✅ DONE (verified live)
- **AAB built + uploaded to the `internal` track.** versionCode `2026062300` / versionName
  `2026.06.23`, package `watch.kubo.app`, signing cert `3A:99:7F…7CC8` (verified). `status` shows
  `internal → v2026062300 status=completed`. Staged copy: `artifacts/kubo-play-v2026.06.23-watch.kubo.app.aab`.
  (The old `artifacts/kubo-v2026.06.12.aab` is `com.kubo.app` = Zapstore, NOT uploadable to Play.)
- **Play App Signing enrolled** — Console App integrity shows "Releases signed by Play." ✓
- **Store listing pushed & LIVE** — title, short + full description (cross-platform-safe copy),
  6 phone screenshots, feature graphic, icon. `listing-diff` = "in sync." Reviewed with the app.
- **Contact email confirmed monitored:** `info@weboftrustfoundation.org`.
- **Public policy docs written** (ready to host): `policies/privacy-policy.md`, `policies/csae-policy.md`.
- **In-app CSAE + privacy pages fixed** (soapbox.pub → WOTF email; analytics-off accuracy).
- **iOS companion** written: `../docs/app-store-publish.md` (same copy reusable for App Store).
- **Terms of Service:** intentionally skipped (not required to publish; optional later at kubo.watch/terms).

## ⬜ TODO — Jeroen (in order)
1. **Deploy the two policy pages** so both return HTTP 200 (currently **404** — HARD GATE):
   - `policies/privacy-policy.md` → `https://kubo.watch/privacy`
   - `policies/csae-policy.md`   → `https://kubo.watch/csae`
   Verify: `curl -sS -o /dev/null -w "%{http_code}\n" https://kubo.watch/privacy` → `200`.
2. **Fill the human-gated Console forms** — all answers pre-written in `CONSOLE-ANSWER-SHEET.md`:
   Policy → App content → App access, Ads, Content rating (IARC), Target audience (18+ only),
   Child safety standards (URL = kubo.watch/csae), Data safety.
3. **Create the Production release** (org account = exempt from the 12-testers/14-day gate — go
   straight to Production) → attach the internal AAB (or promote it) → paste release notes
   (§10 of the answer sheet) → **Send for review**.

## How to rebuild / re-push later (env gotcha)
`publish-play.py`'s java auto-detect fails in non-login shells. Always:
```bash
cd "kubo/play-store"
export JAVA_HOME="$HOME/.sdkman/candidates/java/current"
export PATH="$JAVA_HOME/bin:$PATH"
python3 publish-play.py status                    # live tracks + versionCodes
python3 publish-play.py listing-diff              # local vs live listing
python3 publish-play.py listing-push --confirm    # push listing edits
python3 publish-play.py upload --track internal    # rebuild + upload (bump versionCode first)
```
Bump versionCode/versionName in `android/app/build.gradle` + `package.json` before any new upload
(Play requires strictly-increasing versionCode).

## Key docs
- `CONSOLE-ANSWER-SHEET.md` — every form answer, paste-ready.
- `PLAY-PUBLISH.md` — the tooling runbook.
- `../docs/google-play-publish.md` — narrative runbook (superseded copy points to the listing dir).
- `../docs/app-store-publish.md` — iOS companion.
- Memory: `kubo-store-submission-prep-done` + `kubo-play-publish-tooling` + `kubo-google-play-publish`.
