# Publishing Kubo to Zapstore

Authoritative runbook for shipping a new release-signed Kubo APK to Zapstore. **A future Claude Code session should be able to follow this end-to-end with just user taps on NostraSigner.**

> Recovery card on the user's Desktop: `~/Desktop/KUBO-KEYSTORE-RECOVERY.md`.
> If the keystore or `.env.zapstore` is missing, read that first.

## Prerequisites (verify each time)

Run from the Kubo repo root: `~/VScode workspace for building nostr apps/kubo`.

```bash
# Java + keytool (via SDKMAN — keytool is NOT on default PATH)
source ~/.sdkman/bin/sdkman-init.sh

# Android SDK
export ANDROID_SDK_ROOT="$HOME/Android/Sdk" ANDROID_HOME="$HOME/Android/Sdk"

# zsp CLI (Zapstore publisher) — install once at ~/.local/bin/zsp
which zsp || (
  curl -fsSL -o /tmp/zsp \
    "https://github.com/zapstore/zsp/releases/download/v0.4.10/zsp-0.4.10-linux-amd64" \
  && chmod +x /tmp/zsp && mv /tmp/zsp ~/.local/bin/zsp
)

# Required files (all gitignored; if missing, see KUBO-KEYSTORE-RECOVERY.md)
ls android/app/kubo-release.keystore  # release signing key
ls android/key.properties             # Gradle reads passwords from here
ls .env.zapstore                      # SIGN_WITH (bunker), RELAY_URLS, BLOSSOM_URL

# Branch must be brand/main (Kubo trunk)
git branch --show-current  # → brand/main
```

If any prerequisite is missing, restore it before continuing — do **not** "just regenerate" the keystore (it would change Kubo's permanent Android identity).

## Per-release steps

### 1. Bump version

Edit `android/app/build.gradle`:

- `versionCode` — increment by 1 (Android-side monotonic int).
- `versionName "X.Y.Z"` — semver. Tag prefix is `kubo-v`, so `versionName "0.4.2"` → tag `kubo-v0.4.2`.

### 2. Add a CHANGELOG entry

Add `## [X.Y.Z] - YYYY-MM-DD` at the top of `CHANGELOG.md` (above the previous entry). Zapstore extracts this for the release-notes blob; keep it user-facing, not commit-message-style. The `release_notes: ./CHANGELOG.md` line in `zapstore.yaml` points the publisher at this file.

### 3. Build the release APK

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

### 4. **Verify the APK is signed with our release key (NOT the debug key)**

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

### 5. Dry-run zsp config check

```bash
set -a && source .env.zapstore && set +a
zsp publish --check zapstore.yaml
```

`--check` exits 0 + prints `{"package_id":"com.kubo.app"}` on success. It validates that `zapstore.yaml` parses, the GitHub repo is reachable, and the latest release fetches a usable APK. Fix any issues before going live.

### 6. (First publish only) Link the keystore certificate to the Nostr identity

This is a **one-time** NIP-C1 proof binding the APK signing certificate to the bunker pubkey. Once published, future releases skip this step (zsp will detect the existing link).

```bash
set -a && source .env.zapstore && set +a
KEYSTORE_PASSWORD="$(grep ^storePassword= android/key.properties | cut -d= -f2-)" \
  zsp identity --link-key android/app/kubo-release.keystore
```

NostraSigner will pop a sign request — tap **Approve**.

To check whether the link already exists: `zsp identity --verify android/app/kubo-release.keystore`.

### 7. Publish

`zsp publish` reads the APK path and version from inside `zapstore.yaml`, not from CLI flags. We inject those two lines temporarily, publish, then revert — so trunk's `zapstore.yaml` stays generic.

```bash
set -a && source .env.zapstore && set +a

# Temp-inject release_source + version (matches the old GitLab CI sed pattern)
sed -i "2i version: <X.Y.Z>" zapstore.yaml
sed -i "2i release_source: ./artifacts/kubo-v<X.Y.Z>.apk" zapstore.yaml

# Publish — zsp publish has no -y flag; --quiet auto-confirms but mutes output, so prefer interactive
zsp publish --skip-preview zapstore.yaml

# Revert the injection
git checkout zapstore.yaml
```

The publish command has interactive prompts (Ready-to-Publish confirmation) that need a real TTY, so run from your terminal, not via Claude Code's `Bash` tool. When the bunker prompt appears in nsec.app, tap **Approve**. After the first successful publish, the bunker client key is persisted at `~/.config/zsp/bunker-keys/<pubkey>.key` and future publishes won't re-prompt for pairing.

If `zsp` says "release already published" without doing anything, add `--overwrite-release` to force a re-publish. (Useful if the events were broadcast but you noticed a metadata mistake.)

NostraSigner pops several sign requests in succession (one per Nostr event: kind 32267 app metadata + kind 30063 release + kind 3063 file metadata). Tap **Approve** for each. After the first successful publish, `zsp` persists the bunker client key at `~/.config/zsp/bunker-keys/<pubkey>.key` so future runs reuse the pairing.

On success, zsp prints the published event IDs and the listing URL (typically `https://zapstore.dev/app/com.kubo.app`).

### 8. GitHub release (mirror the APK so non-Zapstore users can sideload)

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

### 9. Post-release bookkeeping

- Move the related `KUBO-XXX` items from `TODO.md` to `DONE.md` with the commit hash.
- Smoke-test on a real Android device: install via Zapstore, launch, verify the kid feed loads. (Existing devices with debug-signed v0.1.x–v0.3.x APKs must uninstall first — signature mismatch is expected.)
- Update memory `kubo-zapstore-publish.md` if anything in the procedure changed.

## Common failures + fixes

- **`apksigner verify` shows `CN=Android Debug, O=Android, C=US`** — Gradle didn't read `key.properties`. Confirm the file exists and isn't empty, and that `storeFile=kubo-release.keystore` (relative to `android/app/`).
- **`zsp identity --link-key` says "Java KeyStore (JKS) format is not supported"** — zsp infers format from extension. Our keystore is real PKCS12 but ends in `.keystore`. There's a symlink `android/app/kubo-release.p12 → kubo-release.keystore`; pass the `.p12` path to `--link-key`. If the symlink is gone: `ln -sf kubo-release.keystore android/app/kubo-release.p12` from inside the kubo dir.
- **`zsp identity --link-key` errors "Unknown client"** — the `bunker://...&secret=...` was already consumed (nsec.app secrets are single-use for pairing). Generate a fresh bunker URL in nsec.app's "Connected apps" panel, replace `SIGN_WITH` in `.env.zapstore`, delete `~/.config/zsp/bunker-keys/<pubkey>.key`, retry.
- **`zsp publish` errors "could not open a new TTY"** — running it via a non-interactive shell (e.g. Claude Code's Bash tool). Run from a real terminal so it can show the Ready-to-Publish prompt. `--quiet` doesn't help here either — it skips prompts but still expects stdout to be a TTY for spinners.
- **`zsp publish` hangs at "waiting for signer"** — the bunker prompt didn't reach nsec.app. Check the tab is open and connected; check that the relays in the bunker URL include at least `wss://relay.nsec.app`.
- **`zsp` errors "developer not whitelisted"** — first-publish hurdle. Zapstore's relay needs to fetch `zapstore.yaml` from the repo and confirm the pubkey matches. Either commit `zapstore.yaml` to `brand/main` and push first, or contact Zapstore admins to whitelist the npub. (Once whitelisted, future publishes are automatic.) **For Kubo this is already done** — the npub `npub1w0tf5rw6hzcjextvc83ct0n8wwk6n848tudnnxxugxm4jj0vqpcs6t3snn` is whitelisted as of the v0.4.1 publish.
- **`zsp publish` says "release already published" and exits silently** — Zapstore's relay deduplicates by `(package_id, version)`. Either bump the version, or pass `--overwrite-release` to force a re-publish of the same version (useful for fixing metadata mistakes without bumping).

## Reference

- zsp docs: https://github.com/zapstore/zsp · https://zapstore.dev/docs/publish
- Original GitLab CI version of this pipeline (frozen, GitHub trunk now): `kubo/.gitlab-ci.yml:76-237`
- Plan that drove the first publish: `~/.claude/plans/i-think-somewhere-last-mellow-flamingo.md`
