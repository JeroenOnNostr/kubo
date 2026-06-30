#!/usr/bin/env python3
"""
publish-play.py — Google Play publishing for Kubo (com.kubo.app).

Mirror of yenn/services/deploy/publish-play.py (same gating, same listing sync),
adapted for Kubo: a Capacitor + npm + Vite app (Ditto soft-fork), NOT Flutter.
Published under the Web of Trust Foundation (WOTF) Play developer account.

Design contract ("automate up to release"):
  • The release TRACK is ALWAYS an explicit choice — `upload` has NO default track and
    refuses if --track is omitted. ALWAYS confirm the track with the user first.
  • internal/alpha/beta — uploaded at status=completed (100% of that track's testers).
  • production — REFUSES unless BOTH `--track production` AND
    `--i-understand-this-is-production`. Even then it goes as a 0%-rollout DRAFT a human
    starts in the console. Two gates. The script never makes a production release live.

Deps (system-wide):  google-api-python-client  google-auth
Key:  kubo/play-store/play-service-account.json  (gitignored; service account
      kubo-play-publisher@kubo-play-publish.iam.gserviceaccount.com)

Usage:
  python3 publish-play.py status                                # show live tracks/versionCodes (run FIRST)
  python3 publish-play.py upload --track internal               # build signed AAB + upload to internal
  python3 publish-play.py upload --track beta --no-build        # upload an existing AAB to beta
  python3 publish-play.py upload --track production --i-understand-this-is-production
  python3 publish-play.py listing-diff                          # local-vs-live listing diff
  python3 publish-play.py listing-push --confirm                # push listing edits (gated)

Before uploading: bump the versionCode in android/app/build.gradle (CalVer YYYYMMDD00,
must be strictly greater than the live max — `status` shows it). The script preflight
WARNS if the local versionCode is not greater than what's already on Play.
"""

import argparse
import hashlib
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

try:
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
except ImportError:
    sys.exit("Missing deps. Run: pip install google-api-python-client google-auth")

# --- Project constants (verified against kubo/android + package.json) ----------
# Google Play package. NOTE: com.kubo.app is taken on Play by an unrelated developer,
# so the PLAY build uses watch.kubo.app (reverse-DNS of kubo.watch). Zapstore/GitHub
# keep com.kubo.app — different channel, different applicationId. The build passes
# -PplayApplicationId to gradle so the Zapstore lineage is untouched.
PACKAGE = "watch.kubo.app"
PLAY_APPLICATION_ID = "watch.kubo.app"
DEPLOY_DIR = Path(__file__).resolve().parent          # kubo/play-store
REPO_ROOT = DEPLOY_DIR.parent                         # kubo/
KEY_FILE = DEPLOY_DIR / "play-service-account.json"
AAB_PATH = REPO_ROOT / "android/app/build/outputs/bundle/release/app-release.aab"
GRADLE_FILE = REPO_ROOT / "android/app/build.gradle"
KEYSTORE = REPO_ROOT / "android/app/kubo-release.keystore"
KEY_PROPS = REPO_ROOT / "android/key.properties"
SCOPES = ["https://www.googleapis.com/auth/androidpublisher"]

# Pinned release-key cert. If the build is signed with anything else (e.g. the debug
# key, when key.properties is unreadable), the AAB is rejected before upload.
RELEASE_CERT_SHA = ("3A:99:7F:99:9D:D6:D3:47:A9:EC:E3:9F:8D:BE:AF:74:"
                    "46:E8:8C:96:36:85:DE:AD:A7:9B:EA:A4:19:F5:7C:C8")

# Store-listing source of truth: text + images under play-listing/<lang>/.
LISTING_DIR = DEPLOY_DIR / "play-listing"
LISTING_TEXT = {
    "title.txt": "title",
    "short_description.txt": "shortDescription",
    "full_description.txt": "fullDescription",
}
LISTING_LIMITS = {"title": 30, "shortDescription": 80, "fullDescription": 4000}
LISTING_IMAGES = {
    "phoneScreenshots": "phoneScreenshots",
    "sevenInchScreenshots": "sevenInchScreenshots",
    "tenInchScreenshots": "tenInchScreenshots",
    "featureGraphic": "featureGraphic",
    "icon": "icon",
}

# Track -> upload behaviour. Track is NEVER defaulted; production is double-gated.
TRACKS = {
    "internal": {"status": "completed", "needs_prod_flag": False,
                 "note": "Internal test build (publish-play.py, Kubo)"},
    "alpha":    {"status": "completed", "needs_prod_flag": False,
                 "note": "Closed (alpha) test build (publish-play.py, Kubo)"},
    "beta":     {"status": "completed", "needs_prod_flag": False,
                 "note": "Open (beta) test build (publish-play.py, Kubo)"},
    "production": {"status": "draft", "needs_prod_flag": True,
                   "note": "Production candidate (publish-play.py, Kubo, staged draft)"},
}


def client():
    if not KEY_FILE.exists():
        sys.exit(
            f"Service-account key not found at {KEY_FILE}\n"
            f"See kubo/play-store/PLAY-PUBLISH.md for setup."
        )
    creds = service_account.Credentials.from_service_account_file(
        str(KEY_FILE), scopes=SCOPES
    )
    return build("androidpublisher", "v3", credentials=creds, cache_discovery=False)


def _build_env():
    env = os.environ.copy()
    home = env["HOME"]
    env.setdefault("ANDROID_SDK_ROOT", f"{home}/Android/Sdk")
    env.setdefault("ANDROID_HOME", f"{home}/Android/Sdk")
    if "JAVA_HOME" not in env:
        try:
            java = subprocess.check_output(
                ["bash", "-lc", "readlink -f $(which java)"], text=True).strip()
            env["JAVA_HOME"] = str(Path(java).parent.parent)
        except subprocess.CalledProcessError:
            sys.exit("Could not locate java for JAVA_HOME. Install JDK 21 (sdkman).")
    return env


def _local_version_code():
    """Parse versionCode from android/app/build.gradle (CalVer integer)."""
    m = re.search(r"versionCode\s+(\d+)", GRADLE_FILE.read_text(encoding="utf-8"))
    return int(m.group(1)) if m else None


def _verify_signing_cert(env):
    """Unzip the AAB's signature block and assert it's the pinned release cert."""
    with tempfile.TemporaryDirectory() as tmp:
        with zipfile.ZipFile(AAB_PATH) as z:
            rsa = [n for n in z.namelist() if n.upper().endswith(".RSA")]
            if not rsa:
                sys.exit("✖ No signature block in AAB — unsigned build. Aborting.")
            z.extract(rsa[0], tmp)
            certfile = Path(tmp) / rsa[0]
        out = subprocess.run(
            ["keytool", "-printcert", "-file", str(certfile)],
            capture_output=True, text=True, env=env,
        ).stdout
        m = re.search(r"SHA256:\s*([0-9A-F:]+)", out)
        got = m.group(1) if m else "(none)"
        if got != RELEASE_CERT_SHA:
            sys.exit(
                f"✖ AAB signed with WRONG cert:\n  got {got}\n  want {RELEASE_CERT_SHA}\n"
                "Gradle likely fell back to the debug key (key.properties unreadable). "
                "Do NOT upload. Fix signing and rebuild."
            )
    print(f"✔ Signing cert verified ({RELEASE_CERT_SHA[:17]}…)")


def build_aab():
    env = _build_env()
    for f in (KEYSTORE, KEY_PROPS):
        if not f.exists():
            sys.exit(f"Missing signing input: {f}")
    print("▶ npm ci…")
    subprocess.run(["npm", "ci"], cwd=REPO_ROOT, check=True, env=env)
    print("▶ vite build…")
    subprocess.run(["npx", "vite", "build", "-l", "error"],
                   cwd=REPO_ROOT, check=True, env=env)
    shutil.copy(REPO_ROOT / "dist/index.html", REPO_ROOT / "dist/404.html")
    print("▶ cap sync android…")
    subprocess.run(["npx", "cap", "sync", "android"],
                   cwd=REPO_ROOT, check=True, env=env)
    subprocess.run(["node", "scripts/patch-cap-config.mjs"],
                   cwd=REPO_ROOT, check=True, env=env)
    print(f"▶ gradle bundleRelease (this is slow; applicationId={PLAY_APPLICATION_ID})…")
    subprocess.run(["./gradlew", "bundleRelease", "--no-daemon",
                    f"-PplayApplicationId={PLAY_APPLICATION_ID}"],
                   cwd=REPO_ROOT / "android", check=True, env=env)
    if not AAB_PATH.exists():
        sys.exit(f"Build reported success but AAB missing at {AAB_PATH}")
    _verify_signing_cert(env)
    size_mb = AAB_PATH.stat().st_size / 1_048_576
    print(f"✔ AAB built & signed: {AAB_PATH}  ({size_mb:.1f} MB)")


def commit_edit(svc, edit_id):
    """Commit, handling the changesNotSentForReview flip-flop."""
    try:
        svc.edits().commit(editId=edit_id, packageName=PACKAGE).execute()
    except HttpError as e:
        if "changes cannot be sent for review automatically" in str(e):
            print("  (retrying commit with changesNotSentForReview=true)")
            svc.edits().commit(
                editId=edit_id, packageName=PACKAGE,
                changesNotSentForReview=True,
            ).execute()
        else:
            raise


def _live_max_version_code(svc):
    """Highest versionCode across all tracks (read-only), or None."""
    edit_id = svc.edits().insert(body={}, packageName=PACKAGE).execute()["id"]
    codes = []
    for t in svc.edits().tracks().list(
            editId=edit_id, packageName=PACKAGE).execute().get("tracks", []):
        for r in t.get("releases", []):
            codes += [int(c) for c in (r.get("versionCodes") or [])]
    try:
        svc.edits().delete(editId=edit_id, packageName=PACKAGE).execute()
    except HttpError:
        pass
    return max(codes) if codes else None


def upload_to_track(track, status, notes):
    svc = client()
    # versionCode preflight: warn (don't block) if the local build won't be accepted.
    local_vc = _local_version_code()
    live_max = _live_max_version_code(svc)
    if local_vc is not None and live_max is not None and local_vc <= live_max:
        print(f"⚠ WARNING: local versionCode {local_vc} is not greater than the live "
              f"max {live_max}. Play will REJECT this upload. Bump versionCode in "
              f"{GRADLE_FILE} (and versionName + package.json) before retrying.")

    print(f"▶ Opening edit transaction for {PACKAGE}…")
    edit_id = svc.edits().insert(body={}, packageName=PACKAGE).execute()["id"]

    print(f"▶ Uploading AAB ({AAB_PATH.name})… (slow; large upload)")
    bundle = svc.edits().bundles().upload(
        editId=edit_id, packageName=PACKAGE,
        media_body=str(AAB_PATH), media_mime_type="application/octet-stream",
    ).execute()
    vc = bundle["versionCode"]
    print(f"✔ Uploaded versionCode {vc}")

    release = {
        "name": f"v{vc}",
        "versionCodes": [str(vc)],
        "status": status,
        "releaseNotes": [{"language": "en-US", "text": notes}],
    }
    print(f"▶ Assigning versionCode {vc} to '{track}' track (status={status})…")
    svc.edits().tracks().update(
        editId=edit_id, packageName=PACKAGE, track=track,
        body={"releases": [release]},
    ).execute()

    print("▶ Committing edit…")
    commit_edit(svc, edit_id)
    print(f"✔ Done. versionCode {vc} is on '{track}'.")
    return vc


def cmd_upload(args):
    track = args.track
    if track not in TRACKS:
        sys.exit(
            "REFUSING: you must pick a release track explicitly.\n"
            "  --track internal | alpha | beta | production\n"
            "There is intentionally NO default — the track is a conscious choice every time."
        )
    cfg = TRACKS[track]
    if cfg["needs_prod_flag"] and not args.i_understand_this_is_production:
        sys.exit(
            "REFUSING. '--track production' additionally requires --i-understand-this-is-production.\n"
            "This pushes a release to the PRODUCTION track of com.kubo.app, tying the Web of Trust\n"
            "Foundation account to the binary and triggering Google review. Even then it goes as a\n"
            "0%-rollout DRAFT a human must 'Start rollout' on in the console — the agent never makes it live."
        )
    if args.no_build and not AAB_PATH.exists():
        sys.exit(f"--no-build set but no AAB at {AAB_PATH}. Build first.")
    if not args.no_build:
        build_aab()

    print(f"\n▶ Target: '{track}' track  (status={cfg['status']})")
    upload_to_track(track, status=cfg["status"], notes=cfg["note"])

    if track == "production":
        print("\n⚠ A DRAFT production release was created at 0% rollout.")
        print("  Nothing is live. A human must open Play Console → Production →")
        print("  review the release and press 'Start rollout' to publish.")
    else:
        print(f"\nNext: open Play Console → Testing → {track.title()} to verify, "
              "or install via the track's opt-in link.")


def cmd_status(args):
    svc = client()
    edit_id = svc.edits().insert(body={}, packageName=PACKAGE).execute()["id"]
    tracks = svc.edits().tracks().list(
        editId=edit_id, packageName=PACKAGE
    ).execute().get("tracks", [])
    if not tracks:
        print("No tracks/releases found (has the first AAB been uploaded manually?).")
    for t in tracks:
        print(f"\nTrack: {t['track']}")
        for r in t.get("releases", []):
            print(f"  • {r.get('name','?')}  status={r.get('status')}  "
                  f"versionCodes={r.get('versionCodes')}  "
                  f"userFraction={r.get('userFraction','-')}")
    local_vc = _local_version_code()
    if local_vc is not None:
        print(f"\nLocal versionCode (build.gradle): {local_vc}")
    try:
        svc.edits().delete(editId=edit_id, packageName=PACKAGE).execute()
    except HttpError:
        pass


def _sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _local_langs():
    if not LISTING_DIR.exists():
        return []
    return sorted(d.name for d in LISTING_DIR.iterdir() if d.is_dir())


def _listing_diff(svc, edit_id, lang):
    """Return (text_changes, image_changes) comparing local files to live listing."""
    langdir = LISTING_DIR / lang
    try:
        live = svc.edits().listings().get(
            editId=edit_id, packageName=PACKAGE, language=lang
        ).execute()
    except HttpError:
        live = {}
    text_changes = []
    for fname, field in LISTING_TEXT.items():
        fpath = langdir / fname
        if not fpath.exists():
            continue
        local = fpath.read_text(encoding="utf-8").rstrip("\n")
        limit = LISTING_LIMITS.get(field)
        if limit and len(local) > limit:
            text_changes.append((field, "ERROR", f"{len(local)} chars > {limit} limit"))
            continue
        if local != (live.get(field) or ""):
            text_changes.append((field, "CHANGED", f"{len(local)} chars"))
    image_changes = []
    for subdir, itype in LISTING_IMAGES.items():
        d = langdir / subdir
        if not d.exists():
            continue
        local_files = sorted(d.glob("*.png")) + sorted(d.glob("*.jpg"))
        local_hashes = {_sha256(f) for f in local_files}
        try:
            live_imgs = svc.edits().images().list(
                editId=edit_id, packageName=PACKAGE, language=lang, imageType=itype
            ).execute().get("images", [])
        except HttpError:
            live_imgs = []
        live_hashes = {im.get("sha256") for im in live_imgs}
        if local_hashes != live_hashes:
            image_changes.append(
                (itype, len(local_files), len(live_imgs),
                 "differs" if local_files else "would CLEAR (no local files)")
            )
    return text_changes, image_changes


def cmd_listing_diff(args):
    svc = client()
    langs = _local_langs()
    if not langs:
        sys.exit(f"No local listing found under {LISTING_DIR}. Nothing to compare.")
    edit_id = svc.edits().insert(body={}, packageName=PACKAGE).execute()["id"]
    any_change = False
    for lang in langs:
        tc, ic = _listing_diff(svc, edit_id, lang)
        print(f"\n=== {lang} ===")
        if not tc and not ic:
            print("  ✔ in sync (local matches live)")
        for field, kind, detail in tc:
            print(f"  TEXT  {field}: {kind} ({detail})")
            any_change = True
        for itype, nlocal, nlive, note in ic:
            print(f"  IMG   {itype}: local={nlocal} live={nlive} → {note}")
            any_change = True
    try:
        svc.edits().delete(editId=edit_id, packageName=PACKAGE).execute()
    except HttpError:
        pass
    print("\n" + ("Changes pending. Run `listing-push --confirm` to apply."
                  if any_change else "Listing is fully in sync. Nothing to push."))


def cmd_listing_push(args):
    if not args.confirm:
        sys.exit(
            "REFUSING without --confirm.\n"
            "listing-push edits the PUBLIC Play store listing for com.kubo.app\n"
            "(title/description/screenshots reviewers and users see). Run\n"
            "`listing-diff` first to review, then re-run with --confirm to apply.\n"
            "This does NOT release a build and does NOT submit the app for review by\n"
            "itself — but listing edits do go to Google for review on commit."
        )
    svc = client()
    langs = _local_langs()
    if not langs:
        sys.exit(f"No local listing under {LISTING_DIR}.")
    edit_id = svc.edits().insert(body={}, packageName=PACKAGE).execute()["id"]
    pushed = False
    for lang in langs:
        langdir = LISTING_DIR / lang
        body = {}
        try:
            live = svc.edits().listings().get(
                editId=edit_id, packageName=PACKAGE, language=lang
            ).execute()
        except HttpError:
            live = {}
        for fname, field in LISTING_TEXT.items():
            fpath = langdir / fname
            if not fpath.exists():
                body[field] = live.get(field, "")
                continue
            val = fpath.read_text(encoding="utf-8").rstrip("\n")
            limit = LISTING_LIMITS.get(field)
            if limit and len(val) > limit:
                sys.exit(f"✖ {lang}/{fname}: {len(val)} chars exceeds {limit}. Aborting.")
            body[field] = val
        body["language"] = lang
        print(f"▶ {lang}: updating listing text…")
        svc.edits().listings().update(
            editId=edit_id, packageName=PACKAGE, language=lang, body=body
        ).execute()
        pushed = True
        tc, ic = _listing_diff(svc, edit_id, lang)
        for itype, nlocal, nlive, note in ic:
            d = langdir / itype
            local_files = sorted(d.glob("*.png")) + sorted(d.glob("*.jpg"))
            if not local_files:
                print(f"  ! {itype}: no local files — SKIPPING (won't clear live images)")
                continue
            print(f"  ▶ {itype}: replacing {nlive} live with {nlocal} local…")
            svc.edits().images().deleteall(
                editId=edit_id, packageName=PACKAGE, language=lang, imageType=itype
            ).execute()
            for f in local_files:
                svc.edits().images().upload(
                    editId=edit_id, packageName=PACKAGE, language=lang,
                    imageType=itype, media_body=str(f),
                    media_mime_type="image/png",
                ).execute()
    if not pushed:
        sys.exit("Nothing to push.")
    print("▶ Committing listing edit…")
    commit_edit(svc, edit_id)
    print("✔ Listing updated. (Listing changes go to Google for review; no build released.)")


def main():
    p = argparse.ArgumentParser(description="Kubo Play publishing (gated).")
    sub = p.add_subparsers(dest="cmd", required=True)

    pu = sub.add_parser("upload",
                        help="build + upload an AAB to a REQUIRED, explicit --track")
    pu.add_argument("--track", choices=["internal", "alpha", "beta", "production"],
                    help="REQUIRED: which release track. No default — you must pick.")
    pu.add_argument("--i-understand-this-is-production", action="store_true",
                    help="extra confirm required for --track production")
    pu.add_argument("--no-build", action="store_true",
                    help="skip the build; upload the existing AAB")
    pu.set_defaults(func=cmd_upload)

    ps = sub.add_parser("status", help="show current tracks/releases + local versionCode")
    ps.set_defaults(func=cmd_status)

    pld = sub.add_parser("listing-diff",
                         help="compare local play-listing/ to the live store listing (read-only)")
    pld.set_defaults(func=cmd_listing_diff)

    plp = sub.add_parser("listing-push",
                         help="GATED: push local play-listing/ to the live store listing")
    plp.add_argument("--confirm", action="store_true",
                     help="required: confirm you intend to edit the public listing")
    plp.set_defaults(func=cmd_listing_push)

    args = p.parse_args()
    try:
        args.func(args)
    except HttpError as e:
        print(f"\n✖ Play API error: {e}", file=sys.stderr)
        if "app does not have any" in str(e).lower() or "no app" in str(e).lower():
            print("Hint: a new app's FIRST AAB must be uploaded via the Play Console "
                  "UI once before the API accepts uploads.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
