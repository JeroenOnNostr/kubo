# Publishing Kubo to Zapstore

Authoritative runbook for the Kubo Zapstore listing at https://zapstore.dev/apps/com.kubo.app. Two flows:

- **[Metadata-only update](#metadata-only-update)** — change description, screenshots, summary, or tags. **No rebuild. No version bump.** ~30 seconds + one nsec.app tap. Use this 90% of the time.
- **[Full release (new APK)](#full-release-new-apk)** — ship a new app version. Bumps version, rebuilds, re-publishes.

> Recovery card on the user's Desktop: `~/Desktop/KUBO-KEYSTORE-RECOVERY.md`.
> If the keystore or `.env.zapstore` is missing, read that first.

## Always-true context

- **Listing:** https://zapstore.dev/apps/com.kubo.app · pubkey hex `73d69a0d...0071`
- **Keystore SHA-256 (must match every published APK):** `3a997f99...7cc8`
- **Tools (already installed):** `~/.local/bin/zsp` (v0.4.10), `~/.local/bin/nak` (v0.19.8)
- **`com.kubo.app` is whitelisted on relay.zapstore.dev** — no first-publish hurdle on republish.
- **Bunker pairing is persisted** at `~/.config/zsp/bunker-keys/73d69a0d...0071.key` — no re-auth needed unless that file is deleted.
- **Run from `kubo/` repo root.** Branch must be `brand/main`.

Every publish loads secrets from `.env.zapstore`:
```bash
set -a && source .env.zapstore && set +a
```

## Metadata-only update

Use this when the user wants to change the listing's description / screenshots / summary / tags / icon — anything *except* shipping a new APK. We re-publish the existing v0.4.x events with `--overwrite-release` so the kind 32267 / 30063 / 3063 events are replaced with new content but point at the same APK.

```bash
cd "/home/jeroen/VScode workspace for building nostr apps/kubo"

# 1. Edit zapstore.yaml — description, summary, tags, images, etc.
#    For images: add files to screenshots/store-N.png so paths in zapstore.yaml resolve.

# 2. Temp-inject release_source + version (zsp reads APK path from yaml, not flags).
#    Use the latest already-published version — we are NOT bumping.
sed -i "2i version: 0.4.1" zapstore.yaml
sed -i "2i release_source: ./artifacts/kubo-v0.4.1.apk" zapstore.yaml

# 3. Publish (works fine via Claude's Bash tool — `-q` suppresses TTY prompts).
set -a && source .env.zapstore && set +a
zsp publish -q --skip-preview --overwrite-release zapstore.yaml

# 4. Revert the temp-injection so trunk's zapstore.yaml stays generic.
git checkout zapstore.yaml
```

Output of step 3 will look broken even on success: `--quiet` mutes success lines and only prints relay failures (e.g. damus.io rate-limit). **Don't trust the output — verify directly:**

```bash
nak req -k 32267 -a 73d69a0ddab8b12c996cc1e385be6773ada99ea75f1b3998dc41b75949ec0071 \
  wss://relay.zapstore.dev | python3 -c "
import sys, json
e = json.loads(sys.stdin.read())
print('CREATED_AT:', e['created_at'])
print('SUMMARY:', next((t[1] for t in e['tags'] if t[0]=='summary'), '?'))
imgs = [t[1] for t in e['tags'] if t[0]=='image']
print('IMAGES:', len(imgs))
for i, u in enumerate(imgs, 1): print(f'  {i}. {u}')
print()
print(e['content'])
"
```

A fresh `created_at` (within the last few minutes) confirms the new event landed. Compare the printed description / image count against what was edited.

**The user must tap Approve in nsec.app** when zsp triggers the bunker. If the prompt doesn't fire within ~10s, the bunker URL or relays may be stale — see [Failures](#failures-and-fixes).

After verification: commit only the changed metadata + image files (leave the user's other in-progress edits alone):

```bash
git add zapstore.yaml screenshots/store-*.png  # adjust to whatever changed
git commit -m "KUBO-XXX: <one-line summary>

<longer description, e.g. new event hashes from cdn.zapstore.dev>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin brand/main
```

Refresh https://zapstore.dev/apps/com.kubo.app — the indexer picks up the new event within minutes.

## Full release (new APK)

### Prerequisites (verify each time)

```bash
source ~/.sdkman/bin/sdkman-init.sh                             # Java/keytool/apksigner
export ANDROID_SDK_ROOT="$HOME/Android/Sdk" ANDROID_HOME="$HOME/Android/Sdk"

ls android/app/kubo-release.keystore android/key.properties .env.zapstore  # all gitignored
git branch --show-current                                        # → brand/main

# Reinstall zsp / nak only if missing (see KUBO-KEYSTORE-RECOVERY.md if .env.zapstore is gone)
which zsp || curl -fsSL -o ~/.local/bin/zsp \
  "https://github.com/zapstore/zsp/releases/download/v0.4.10/zsp-0.4.10-linux-amd64" \
  && chmod +x ~/.local/bin/zsp
which nak || curl -fsSL -o ~/.local/bin/nak \
  "https://github.com/fiatjaf/nak/releases/download/v0.19.8/nak-v0.19.8-linux-amd64" \
  && chmod +x ~/.local/bin/nak
```

If any prerequisite is missing, restore it before continuing — do **not** regenerate the keystore (it would change Kubo's permanent Android identity).

### Per-release steps

#### 1. Bump version

Kubo uses **calendar versioning**: the version is the release date as `vYEAR.MONTH.DAY` (e.g. a build released on 11 June 2026 is `2026.06.11`). Keep `package.json` `"version"` and the gradle values below in sync — set all to the same release date.

Edit `android/app/build.gradle`:

- `versionCode` — the release date as an integer `YYYYMMDD` (e.g. `20260611`). Stays monotonic as long as each release has a later date.
- `versionName "YEAR.MM.DD"` — the calendar version (zero-padded month/day, e.g. `2026.06.11`). Tag prefix is `kubo-v`, so `versionName "2026.06.11"` → tag `kubo-v2026.06.11`.

#### 2. Add a CHANGELOG entry

Add `## [X.Y.Z] - YYYY-MM-DD` at the top of `CHANGELOG.md` (above the previous entry). Zapstore extracts this for the release-notes blob; keep it user-facing, not commit-message-style. The `release_notes: ./CHANGELOG.md` line in `zapstore.yaml` points the publisher at this file.

#### 3. Build the release APK

```bash
source ~/.sdkman/bin/sdkman-init.sh
export ANDROID_SDK_ROOT="$HOME/Android/Sdk" ANDROID_HOME="$HOME/Android/Sdk"

npm ci
npx vite build -l error
cp dist/index.html dist/404.html
npx cap sync android
node scripts/patch-cap-config.mjs
(cd android && ./gradlew assembleRelease)

mkdir -p artifacts
cp android/app/build/outputs/apk/release/app-release.apk artifacts/kubo-v<X.Y.Z>.apk
```

Substitute `<X.Y.Z>`. Build takes ~45s on a warm cache (~3 min cold).

#### 4. **Verify the APK is signed with our release key (NOT the debug key)**

```bash
source ~/.sdkman/bin/sdkman-init.sh  # apksigner needs java on PATH
~/Android/Sdk/build-tools/36.0.0/apksigner verify --print-certs \
  artifacts/kubo-v<X.Y.Z>.apk
```

Expected output:

```
Signer #1 certificate DN: CN=Kubo, OU=Unknown, O=Web of Trust Foundation, ...
Signer #1 certificate SHA-256 digest: 3a997f999dd6d347a9ece39f8dbeaf7446e88c963685deada79beaa419f57cc8
```

If the SHA-256 does **not** match `3a997f99...7cc8`, **stop**. Either Gradle silently fell back to the debug key (means `key.properties` isn't being read) or someone replaced the keystore. Do not publish.

#### 5. Dry-run zsp config check

```bash
set -a && source .env.zapstore && set +a
zsp publish --check zapstore.yaml
```

`--check` exits 0 + prints `{"package_id":"com.kubo.app"}` on success. It validates that `zapstore.yaml` parses, the GitHub repo is reachable, and the latest release fetches a usable APK. Fix any issues before going live.

#### 6. (First publish only — already done for Kubo, skip)

The NIP-C1 identity proof binding the APK signing cert (`3a997f99...7cc8`) to the bunker pubkey (`73d69a0d...0071`) was published 2026-05-06 with 1y validity. zsp checks this automatically on every `zsp publish`. **Skip this step until 2027-05-06 or until the keystore is rotated.**

If renewing: `KEYSTORE_PASSWORD="$(grep ^storePassword= android/key.properties | cut -d= -f2-)" zsp identity --link-key android/app/kubo-release.p12` (note `.p12` symlink — see [Failures](#failures-and-fixes)).

#### 7. Publish

`zsp publish` reads APK path and version from `zapstore.yaml`, not from CLI flags. Temp-inject, publish, revert.

```bash
set -a && source .env.zapstore && set +a
sed -i "2i version: <X.Y.Z>" zapstore.yaml
sed -i "2i release_source: ./artifacts/kubo-v<X.Y.Z>.apk" zapstore.yaml

zsp publish -q --skip-preview zapstore.yaml

git checkout zapstore.yaml
```

`-q` (auto-confirm + mute prompts) works fine via Claude's Bash tool. **Don't trust the output** — `-q` mutes success lines and only echoes relay failures (damus.io rate-limit is normal). Verify directly via the [verify-via-nak](#metadata-only-update) snippet — it should show the new version + a fresh `created_at`.

User taps **Approve** in nsec.app when the bunker prompt fires (one tap covers all three events on a successful pairing).

#### 8. GitHub release (mirror the APK so non-Zapstore users can sideload)

```bash
git add zapstore.yaml CHANGELOG.md android/app/build.gradle  # whatever changed
git commit -m "KUBO-XXX: release v<X.Y.Z>"
git push origin brand/main

git tag kubo-v<X.Y.Z>
git push origin kubo-v<X.Y.Z>

gh release create kubo-v<X.Y.Z> \
  --repo JeroenOnNostr/kubo \
  --title "Kubo v<X.Y.Z>" \
  --notes-file <(awk "/^## \[<X.Y.Z>\]/{p=1; next} /^## \[/{if(p) exit} p" CHANGELOG.md) \
  artifacts/kubo-v<X.Y.Z>.apk
```

(Replace `<X.Y.Z>` everywhere. The `awk` extracts that version's CHANGELOG section as the release notes.)

#### 9. Post-release bookkeeping

- Move the related `KUBO-XXX` items from `TODO.md` to `DONE.md` with the commit hash.
- Smoke-test on a real Android device: install via Zapstore, launch, verify the kid feed loads. (Existing devices with debug-signed v0.1.x–v0.3.x APKs must uninstall first — signature mismatch is expected.)
- Update memory `kubo-zapstore-publish.md` if anything in the procedure changed.

## Failures and fixes

- **`apksigner verify` shows `CN=Android Debug, O=Android, C=US`** — Gradle didn't read `key.properties`. Confirm the file exists and isn't empty, and that `storeFile=kubo-release.keystore` (relative to `android/app/`).
- **`zsp identity --link-key` says "Java KeyStore (JKS) format is not supported"** — zsp infers format from extension. Our keystore is real PKCS12 but ends in `.keystore`. There's a symlink `android/app/kubo-release.p12 → kubo-release.keystore`; pass the `.p12` path to `--link-key`. If the symlink is gone: `ln -sf kubo-release.keystore android/app/kubo-release.p12` from inside the kubo dir.
- **`zsp identity --link-key` errors "Unknown client"** — the `bunker://...&secret=...` was already consumed (nsec.app secrets are single-use for pairing). Generate a fresh bunker URL in nsec.app's "Connected apps" panel, replace `SIGN_WITH` in `.env.zapstore`, delete `~/.config/zsp/bunker-keys/<pubkey>.key`, retry.
- **`zsp publish` errors "could not open a new TTY"** — happens when running without `-q` from a non-interactive shell (Claude's Bash tool). The fix is `-q --skip-preview`; quiet mode bypasses both the Ready-to-Publish confirmation *and* the browser-preview prompt. Don't drop `-q` thinking it'll show progress — the success lines stay muted, but the publish still works; verify via `nak req` instead.
- **`zsp publish` hangs at "waiting for signer"** — the bunker prompt didn't reach nsec.app. Check the tab is open and connected; check that the relays in the bunker URL include at least `wss://relay.nsec.app`.
- **`zsp` errors "developer not whitelisted"** — first-publish hurdle. Zapstore's relay needs to fetch `zapstore.yaml` from the repo and confirm the pubkey matches. Either commit `zapstore.yaml` to `brand/main` and push first, or contact Zapstore admins to whitelist the npub. (Once whitelisted, future publishes are automatic.) **For Kubo this is already done** — the npub `npub1w0tf5rw6hzcjextvc83ct0n8wwk6n848tudnnxxugxm4jj0vqpcs6t3snn` is whitelisted as of the v0.4.1 publish.
- **`zsp publish` says "release already published" and exits silently** — Zapstore's relay deduplicates by `(package_id, version)`. Either bump the version, or pass `--overwrite-release` to force a re-publish of the same version (useful for fixing metadata mistakes without bumping).

## Reference

- zsp docs: https://github.com/zapstore/zsp · https://zapstore.dev/docs/publish
- Original GitLab CI version of this pipeline (frozen, GitHub trunk now): `kubo/.gitlab-ci.yml:76-237`
- Plan that drove the first publish: `~/.claude/plans/i-think-somewhere-last-mellow-flamingo.md`
