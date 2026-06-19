# Publishing Kubo to the Google Play Store — Runbook (KUBO-192)

This is the per-release procedure for shipping Kubo to **Google Play**, the companion to
`docs/zapstore-publish.md`. Play is account-gated and human-reviewed: roughly half of this is
clicking through the Play Console under your own login. Everything that *can* be automated
locally (building the signed AAB, preparing assets) is automated; the rest is scripted below as
exact console steps with pre-written answers.

> **Audience decision (locked 2026-06-12):** Kubo is submitted as an **adults / parents** app.
> We deliberately do **NOT** opt into the "Designed for Families" / Teacher Approved program for
> the first launch — that track is the strictest review path Google has and is hostile to Nostr's
> user-generated content model. The store framing is *"a tool for parents to curate their child's
> feed"*, used on the parent's supervised device. If you later want Kubo formally listed *for
> children*, that's a separate, much harder submission — re-open this decision first.

---

## Permanent identity (shared with Zapstore — do NOT change)

- **Upload/signing keystore:** `android/app/kubo-release.keystore` (PKCS12, RSA 4096, alias `kubo-release`)
  - SHA-256: `3A:99:7F:99:9D:D6:D3:47:A9:EC:E3:9F:8D:BE:AF:74:46:E8:8C:96:36:85:DE:AD:A7:9B:EA:A4:19:F5:7C:C8`
  - Backup: `~/Documents/kubo-release.keystore.backup`
  - Password: only in the user's password manager ("Kubo Android release keystore").
- **Application ID:** `com.kubo.app` — must match Zapstore. Cannot ever change once published on Play.

### Play App Signing (one-time enrollment, first upload)
When you create the app in Play Console and upload the first AAB, Play offers **Play App Signing**.
**Accept it.** This means:
- The keystore above becomes your **upload key** (you keep using it to sign AABs you upload).
- Google holds the real **app signing key** and re-signs the APKs delivered to users.
- Consequence: the APK users get from **Play** is signed by Google's key, NOT by our keystore.
  The **Zapstore** APK is still signed by our keystore. **The two distribution channels will
  therefore have different signing certificates** — a device that installed Kubo from Zapstore
  cannot in-place update from Play and vice-versa (Android blocks cross-signer updates). This is
  expected and acceptable; just don't tell users to switch channels mid-stream.
- You can optionally register our upload cert's SHA-256 (above) so Google knows it.

---

## Step 0 — One-time: create the Play Developer account (YOU, ~$25, can take days)

1. Go to https://play.google.com/console/signup
2. Choose account type. Since this app is **adults/parents** and you're launching solo:
   - **Personal** account is fastest (gov-ID verification, no D-U-N-S needed).
   - **Organization** (Web of Trust Foundation) requires a **D-U-N-S number** + org verification —
     slower, but better long-term branding. Decide based on whether WOTF should legally own it.
3. Pay the **one-time $25 USD** registration fee.
4. Complete **identity verification** (ID upload; for org, also org docs). This can take 1–5 days.
   You cannot publish until verification clears.
5. New 2023+ accounts also face a **testing requirement** before production access:
   personal accounts must run a **closed test with ≥12 testers for ≥14 continuous days** before
   the "Production" track unlocks. **Plan for this** — see Step 6. (Org accounts may be exempt;
   the console will tell you.)

---

## Step 1 — Build the signed AAB (automated, run locally)

Play requires an **Android App Bundle (`.aab`)**, not the `.apk` Zapstore uses.

```bash
cd "/home/jeroen/VScode workspace for building nostr apps/kubo"
# 1. Build the web bundle and sync into the Android project
npm run build
npx cap sync android

# 2. Build the signed release bundle
source ~/.sdkman/bin/sdkman-init.sh
export JAVA_HOME="$(dirname $(dirname $(readlink -f $(which java))))"
cd android && ./gradlew bundleRelease --no-daemon && cd ..

# 3. Stage the artifact with a versioned name
cp android/app/build/outputs/bundle/release/app-release.aab \
   "artifacts/kubo-v$(grep versionName android/app/build.gradle | head -1 | grep -oE '[0-9.]+').aab"
```

### CRITICAL pre-upload gate — verify the AAB is signed with the real keystore

AABs can't be checked with `apksigner verify` directly. Extract the embedded cert and compare:

```bash
cd "/home/jeroen/VScode workspace for building nostr apps/kubo"
source ~/.sdkman/bin/sdkman-init.sh
TMP=$(mktemp -d)
unzip -o -q artifacts/kubo-v*.aab -d "$TMP"
keytool -printcert -file "$(find "$TMP" -name '*.RSA' | head -1)" | grep -i SHA256
rm -rf "$TMP"
```

The SHA-256 **must** equal `3A:99:7F...7CC8`. If you see `CN=Android Debug` / a different hash,
Gradle fell back to the debug keystore (`android/key.properties` missing/unreadable) — stop and
fix; do NOT upload a debug-signed bundle.

**Status for v2026.06.12:** built, verified ✓. Artifact at `artifacts/kubo-v2026.06.12.aab`,
cert SHA-256 confirmed `3A:99:7F...7CC8`.

---

## Step 2 — Create the app in Play Console (YOU)

Play Console → **Create app**:
- App name: **Kubo**
- Default language: **English (United States) – en-US**
- App or game: **App**
- Free or paid: **Free**
- Declarations: accept Developer Program Policies + US export laws.

---

## Step 3 — Store listing (copy/paste ready)

Play Console → **Grow → Store presence → Main store listing**

| Field | Value |
|---|---|
| **App name** (30 chars) | `Kubo` |
| **Short description** (80 chars) | `Kids' video, curated by people you trust — not by an algorithm.` |
| **Full description** (4000 chars) | see block below |

**Full description:**
```
Kubo is a YouTube Kids alternative built around trust, not algorithms.

Parents decide which people, feeds, and creators their child can access. Kubo avoids
black-box recommendations, addictive design patterns, and behavioral tracking. There is
no infinite autoplay rabbit hole and no engagement-maximizing feed.

Instead of letting a platform decide what your child sees, Kubo uses webs of trust: as a
parent, you build an online environment shaped by family, friends, schools, creators, and
communities you actually know. The child's feed only ever shows content from people you've
admitted — strangers and algorithmic reach simply can't get in. If the trust data can't be
loaded, the feed fails closed and shows nothing, rather than leaking unvetted content.

Kubo is built on Nostr, an open and decentralized protocol, and is the reference
implementation for TEPP — the Trust Extended Permissions Protocol. Because it's open, your
family isn't locked into a single company's servers or business model.

What you get:
• A parent-curated video feed for your child — no recommendation engine
• Webs of trust: add the people, schools, and creators you know
• Trust on by default — the feed is safe from the very first launch
• No behavioral ads, no engagement tracking, no dark patterns
• Open source (AGPL-3.0) and built on open protocols

Kubo is a tool for parents. You set it up on a device you supervise and decide exactly who
and what your child can see.

Learn more:
https://kubo.watch
https://weboftrustfoundation.com
```

**Graphics** (all in `play-store/`):
| Asset | File | Spec |
|---|---|---|
| App icon | `play-store/icon-512.png` | 512×512, 32-bit PNG ✓ |
| Feature graphic | `play-store/feature-graphic-1024x500.png` | 1024×500 PNG ✓ |
| Phone screenshots | `play-store/screenshots/store-1..6.png` | 852×1846, 6 provided (need 2–8) ✓ |

> Play also asks for a 7"/10" tablet screenshot set if you declare tablet support. We are
> phone-only for v1 — leave tablet sets empty (allowed).

**Categorization:**
- App category: **Parenting** (best fit; alt: *Education*). NOT a kids/family category.
- Tags: parenting, video players & editors (pick the closest offered).
- Contact email: a real address you monitor (e.g. an @weboftrustfoundation.com address).
- Website: `https://kubo.watch`
- **Privacy Policy URL: `https://kubo.watch/privacy`** (must be live & public — verify it loads).

---

## Step 4 — App content / policy forms (YOU — pre-filled answers below)

Play Console → **Policy → App content**. Each must be completed before you can publish.

### 4a. Privacy policy
Paste `https://kubo.watch/privacy`. (In-app route `/privacy`, also reachable in the deployed
web app. Contact line now points to weboftrustfoundation.com, fixed in KUBO-192.)

### 4b. Ads
- **Does your app contain ads?** → **No.** (Kubo serves no ads.)

### 4c. App access
- Is any functionality restricted (login/region)? → Kubo needs a Nostr identity but **creates one
  on the fly during onboarding — no special credentials required**. Select **"All functionality is
  available without special access"**. (If the reviewer can't get past onboarding, switch to
  "restricted" and provide steps, but the on-the-fly keygen means it shouldn't be needed.)

### 4d. Content rating (IARC questionnaire)
- Category: **Reference, News, or Educational** (or *Utility/Productivity*). NOT a game.
- Answer **No** to all violence/sexual/profanity/gambling/drugs questions for Kubo's own content.
- **User-generated / online content:** This is the honest, important one. Kubo connects to the
  Nostr network. Even though the child's feed is parent-gated, the *app technically communicates
  online and can surface user content in the parent area*. Answer **Yes** to "Users can interact /
  share / the app contains user-generated or online content." This will likely yield a **Teen/
  Mature-ish** rating, which is *fine and correct* for an adults/parents app — do NOT try to game
  it to "Everyone", that contradicts the audience declaration and risks removal.
- Expect IARC to email the assigned rating; it applies automatically.

### 4e. Target audience and content ("Designed for Families")
- **Target age groups:** select **18 and over** only. Do NOT tick any under-18 box.
  (Ticking a child age band forces the Families program + content-filtering proof — the path we
  explicitly chose to avoid.)
- "Could your app appeal to children?" → Google may flag this since the listing mentions kids.
  Answer truthfully: the **app is operated by a parent/adult**; it is a parental tool. Make the
  store copy's "tool for parents… you set it up on a device you supervise" framing consistent with
  this. If Google insists the store presence appeals to children, you'll be pushed toward the
  Families program — if that happens, **pause and reconsider**, don't just accept it blind.

### 4f. Data safety
Play Console → **Data safety**. Answers reflecting Kubo's actual behavior:
- **Does your app collect or share any required user data?** → **Yes** (minimal; see below).
- **Is all data encrypted in transit?** → Yes (HTTPS/WSS to relays; DMs NIP-44/04 encrypted).
- **Do you provide a way to request data deletion?** → Partial. Nostr is decentralized; the app
  can publish NIP-09 delete events but relays aren't obligated to honor them. Describe this; link
  the privacy policy's "Data Removal" section.
- Data types to declare:
  - **App activity / Other user-generated content** — *Collected & shared* (published Nostr
    events are public by design), **not** for ads, user can't be required to opt out (it's the
    app's core function), purpose: **App functionality**.
  - **App info & performance / Crash logs & diagnostics** — **declare NONE.** Verified
    (KUBO-192): Plausible is bundled but config-gated on `config.plausibleDomain`, and the
    shipped `kubo.json` default is `plausibleDomain: ""` → `PlausibleProvider` never calls
    `init()`. The production build collects **no analytics**. (If you ever set a non-empty
    `plausibleDomain`, come back and add an Analytics declaration here.)
  - **Device or other IDs** — relays log IP addresses (connection metadata). IP is generally not a
    declarable "collected" data type by *you* unless you operate the relay; we don't. Note it in
    the policy (already done) but you typically declare it under "Device or other IDs / not
    collected by us". Use judgment; when unsure, over-disclose.
- No financial info, no precise location, no contacts, no health data collected by Kubo.

> **Resolved (KUBO-192):** the production build does NOT initialize Plausible — `plausibleDomain`
> defaults to `""`, which short-circuits `PlausibleProvider`. No analytics declaration needed.

---

## Step 5 — Upload the AAB

Play Console → **Test and release → (track) → Create new release**.
- If prompted, **opt into Play App Signing** (see top of this doc).
- Upload `artifacts/kubo-v2026.06.12.aab`.
- **Release name:** `2026.06.12` (matches versionName).
- **Release notes** (`en-US`): paste the "Added/Changed/Fixed" bullets from `CHANGELOG.md`'s
  top section, trimmed to user-facing language. Keep under 500 chars per language.

---

## Step 6 — Testing tracks (mandatory for new personal accounts)

New personal Play accounts must complete a **closed test before Production unlocks**:
- Create a **Closed testing** track, upload the AAB there first.
- Recruit **≥12 testers** (email list or Google Group), keep them opted in for **≥14 continuous
  days**. They must actually install/run it.
- After 14 days, Google surfaces an **"Apply for production"** button.
- Org accounts may skip this — the console states your specific requirement.

**Practical path:** upload to **Internal testing** immediately (instant, up to 100 testers, no
14-day rule) to smoke-test the exact AAB on real devices, then run the formal **Closed test** for
the 14-day clock in parallel.

---

## Step 7 — Submit for review

Once all of: store listing ✓, content rating ✓, data safety ✓, target audience ✓, app access ✓,
privacy policy ✓, and (for new accounts) the closed-testing requirement ✓ — click
**Send for review** on the Production release. Initial review for a new developer can take
**several days to a few weeks**. Expect possible back-and-forth specifically about the
kids-adjacent framing vs. the 18+ audience declaration; keep them consistent and you'll be fine.

---

## Recurring releases (after first launch)

1. Bump `versionCode` + `versionName` in `android/app/build.gradle` (calendar scheme: `YYYYMMDD`
   / `YYYY.MM.DD`). **`versionCode` must strictly increase** every Play upload.
2. Re-run **Step 1** (build + verify cert).
3. Play Console → new release on the desired track → upload AAB → release notes → review.
4. No need to redo the policy/data-safety forms unless behavior changed.

> Keep this in lockstep with `docs/zapstore-publish.md`: same version, same `versionCode`, same
> keystore. Zapstore ships the APK; Play ships the AAB (re-signed by Google). Publish to both from
> the same build commit.
