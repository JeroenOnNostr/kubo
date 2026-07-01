# Kubo — Google Play Console answer sheet (paste-ready)

Everything you need to click through the Play Console for **watch.kubo.app** under the **Web of
Trust Foundation** account. Each section maps to a Console screen with the exact answer to enter.
The listing **text + images** are already automatable via `publish-play.py listing-push` (after
the first AAB upload); this sheet is for the **human-gated** forms the API cannot fill.

- **Play package / applicationId:** `watch.kubo.app` (NOT `com.kubo.app` — taken on Play).
- **Account type:** Organization (Web of Trust Foundation) → **exempt** from the new-account
  12-testers / 14-day closed-testing gate. You can target **Production** directly.
- **Listing language:** English (United States) — en-US.

---

## 0. First AAB — DONE ✓ (2026-06-30)

**Already built and uploaded.** `python3 publish-play.py upload --track internal` built the AAB
for `watch.kubo.app` (versionCode `2026062300`), verified the signing cert (`3A:99:7F…7CC8`), and
**the API upload to the internal track succeeded** — it is now live on **Testing → Internal
testing**, `status=completed`. Staged copy: `artifacts/kubo-play-v2026.06.23-watch.kubo.app.aab`.

> NOTE — this contradicts the old assumption that a brand-new app's first release must go through
> the Console UI. For `watch.kubo.app` the API accepted the first internal-track upload directly.
> The one thing the API does NOT do is show the **"accept Play App Signing"** prompt — verify
> enrollment in App integrity → App signing (see the hard-gates checklist, §11).

To build a future release: bump `versionCode`/`versionName` in `android/app/build.gradle` +
`package.json`, then `python3 publish-play.py upload --track <track>` (set `JAVA_HOME=$HOME/.sdkman/
candidates/java/current` first — the script's auto-detect fails in non-login shells).

1. Build the signed AAB (from `kubo/play-store/`):
   `python3 publish-play.py upload --track internal` — it builds with
   `applicationId=watch.kubo.app`, verifies the signing cert, then **fails at the upload step**
   for the first release. That's expected. The AAB is at
   `kubo/android/app/build/outputs/bundle/release/app-release.aab`.
   - First **bump versionCode** if needed — run `python3 publish-play.py status` and make the
     local `versionCode` strictly greater than any live one (currently all tracks empty, so
     `2026062300` is fine; bump anyway if you rebuild on a later day).
2. Play Console → **Testing → Internal testing → Create new release** → drag the AAB in.
3. When prompted, **accept Play App Signing** (irreversible, one-time). Our keystore becomes the
   *upload* key; Google holds the *app-signing* key. (This is why the Play APK and the Zapstore APK
   have different certs — expected, don't switch users between channels.)
4. After it processes, `python3 publish-play.py status` shows the release and all subsequent API
   uploads + listing pushes work.

---

## 1. Create app (already done — for reference)

- App name: **Kubo**
- Default language: **English (United States) – en-US**
- App or game: **App**
- Free or paid: **Free**
- Declarations: accept Developer Program Policies + US export laws.

---

## 2. Main store listing  → Grow → Store presence → Main store listing

Text + graphics come from `play-store/play-listing/en-US/` and can be pushed with
`publish-play.py listing-push --confirm`. For manual entry, the values are:

| Field | Value |
|---|---|
| App name (≤30) | `Kubo` |
| Short description (≤80) | `Video for your child, curated by people you trust — not by an algorithm.` |
| Full description (≤4000) | contents of `play-listing/en-US/full_description.txt` |
| App icon (512×512) | `play-listing/en-US/icon/icon-512.png` |
| Feature graphic (1024×500) | `play-listing/en-US/featureGraphic/featureGraphic.png` |
| Phone screenshots (852×1846 ×6) | `play-listing/en-US/phoneScreenshots/01–06.png` |
| Tablet screenshots | leave empty (phone-only for v1 — allowed) |

These screenshots and graphics are **the same images used on the Zapstore listing**, so the two
store pages match by design.

**Store settings → Categorization:**
- App category: **Parenting** (NOT a kids/family category).
- Tags: pick the closest offered — *Parenting*, *Video players & editors*.
- Contact email: **info@weboftrustfoundation.org**
- Website: `https://kubo.watch`
- Privacy policy: `https://kubo.watch/privacy` — **must be live first** (see §7).

> **Terms of Service:** intentionally NOT created (decided 2026-06-30). Neither Play nor Apple
> requires a ToS/EULA to publish — only the Privacy Policy is a hard gate. A ToS at
> `kubo.watch/terms` is recommended later for a kids-adjacent / AGPL / decentralized app (parent-
> operator responsibilities, "as is" warranty + liability disclaimer, acceptable-use linking the
> CSAE policy) but does not affect this submission.

---

## 3. App access  → Policy → App content → App access

Select **"All functionality is available without special access."**
Kubo creates a Nostr identity on the fly during onboarding — no login, code, or special
credentials are needed for a reviewer to use the full app.

---

## 4. Ads  → Policy → App content → Ads

**Does your app contain ads?** → **No.** (Kubo serves no ads.)

---

## 5. Content rating  → Policy → App content → Content rating

Start the **IARC questionnaire**.

- Email: **info@weboftrustfoundation.org**
- Category: **Reference, News, or Educational** (NOT a game).

| Question | Answer |
|---|---|
| Violence (cartoon / realistic / fantasy) | No |
| Sexual content or nudity | No |
| Profanity or crude humor | No |
| Controlled substances (alcohol/tobacco/drugs) | No |
| Simulated gambling | No |
| Scary / horror content | No |
| **Users can interact / share content** | **Yes** |
| **Shares user-generated content** | **Yes** (Kubo connects to the Nostr network) |
| **Users can communicate (chat/messages)** | **Yes** (parent group chat) |
| Unrestricted access to the internet / web | Yes |
| Shares the user's physical location | No |
| Collects/shares personal info for ads | No |

> Expect a **Teen / Mature**-band rating because of the user-generated-content and
> open-network answers. **That is correct for an adults/parents app — do NOT try to game it down to
> "Everyone."** A rating that contradicts the audience declaration is a removal risk. IARC emails
> the assigned rating; it applies automatically.

---

## 6. Target audience and content  → Policy → App content → Target audience

- **Target age groups:** tick **18 and over** ONLY. Do NOT tick any under-18 band.
  (Ticking a child band forces the *Designed for Families* program + content-filtering proof — the
  path we deliberately avoid.)
- **"Could your store listing unintentionally appeal to children?"** → Answer honestly that Kubo
  is a **tool operated by a parent/adult on a supervised device**; children are the *beneficiaries*
  of the parent's curation, not the app's operators. The listing copy reinforces this with the line
  *"designed to be operated by an adult, not configured by a child."*
- If Google nonetheless pushes you toward the Families program, **pause and reconsider** — do not
  accept it blindly (see the audience-decision box in `docs/google-play-publish.md`).

---

## 7. Child safety standards  → Policy → App content → Child safety standards

Google requires this section for apps that surface UGC and relate to children.

- **Published child safety standards URL:** `https://kubo.watch/csae`
  (source: `play-store/policies/csae-policy.md` — **must be live first**, see §10).
- **In-app CSAE reporting:** Yes — users can report any post/profile in-app.
- **Designated child-safety contact:** **info@weboftrustfoundation.org**
- **Compliance with CSAE laws / NCMEC reporting:** Yes — the policy commits to reporting to the
  NCMEC CyberTipline and cooperating with law enforcement.

---

## 8. Data safety  → Policy → App content → Data safety

| Question | Answer |
|---|---|
| Does your app collect or share required user data? | **Yes** (minimal — below) |
| Is all data encrypted in transit? | **Yes** (HTTPS / secure WebSockets; DMs NIP-44/04) |
| Do you provide a way to request data deletion? | **Yes, partial** — app can publish NIP-09 delete events; relays aren't obligated to honor them. Link the privacy policy's "Data Removal" section. |

**Data types to declare:**

- **App activity → Other user-generated content** — **Collected and Shared.**
  - Collected & shared because published Nostr events are public by design.
  - Purpose: **App functionality**. NOT for ads or analytics.
  - Can the user opt out? No — it's the core function (publishing to relays).
- **App info and performance → Crash logs / Diagnostics** — **Declare NONE.**
  - Verified: the shipped build has analytics disabled (`plausibleDomain: ""` short-circuits the
    analytics provider; no init call). **If a non-empty `plausibleDomain` is ever set, revisit
    this and add an Analytics declaration.**
- **Device or other IDs** — Relays (often third-party) can see your IP at connection time. Kubo
  does not itself collect/store IPs. Declare under "not collected by us"; if unsure, over-disclose
  with a note that IP is visible to independently operated relays.

**Not collected:** financial info, precise location, contacts, health data, photos/files beyond
what the user explicitly publishes, advertising identifiers.

---

## 9. Other declarations (answer as you reach them)

- **Government app?** No.
- **News app?** No.
- **COVID-19 contact tracing/status app?** No.
- **Financial features?** No.
- **Health / medical?** No.
- **Advertising ID permission (`com.google.android.gms.permission.AD_ID`)?** Not used — declare
  the app does not use an advertising ID.

---

## 10. Release notes (en-US, ≤500 chars) — for version 2026.06.23

Paste into the release's "What's new" field (or pass via `publish-play.py`). 479 chars:

```
Kubo now speaks in plain, everyday language — "places" instead of technical terms, and "profile lists" for shared follow lists. Trust is now always on for every child and can't be turned off, so the feed stays protected. The Support page now invites your feedback and shows our Web of Trust Foundation branding. Also fixed: creator channels no longer appear twice; no more flashing "Suggested" tag; place search now matches across the app; and the child feed shows the "Next post" button again.
```

---

## 11. Hard gates before "Send for review"

- [x] **First AAB built + uploaded** — `watch.kubo.app`, versionCode `2026062300`, cert
      `3A:99:7F…7CC8` verified; live on the **internal** track (`status=completed`), 2026-06-30.
      Surprise vs. the old runbook: the **API upload succeeded** (no Console-UI first-upload needed).
- [ ] **Confirm Play App Signing is enrolled** — Play Console → App integrity → **App signing**
      tab. You should see two certificates (Google's *app signing* cert + our *upload* cert ending
      `…7CC8`). API uploads normally auto-enroll; just verify, nothing to accept if already shown.
- [ ] `https://kubo.watch/privacy` returns HTTP 200 (currently 404 — deploy `policies/privacy-policy.md`).
- [ ] `https://kubo.watch/csae` returns HTTP 200 (currently 404 — deploy `policies/csae-policy.md`).
- [x] **Store listing pushed** (§2) — title + short/full description + 6 screenshots + feature
      graphic + icon are LIVE and in sync (`listing-diff` clean), 2026-06-30. Listing changes go to
      Google for review along with the app.
- [ ] Content rating received (§5).
- [ ] Target audience = 18+ (§6).
- [ ] Child safety standards saved (§7).
- [ ] Data safety saved (§8).
- [x] **Contact email confirmed** — `info@weboftrustfoundation.org` is monitored (confirmed
      2026-06-30). In-app privacy/CSAE pages + both policy docs all use this address.

Because this is an **organization** account, you do **not** need the 12-testers / 14-day closed
test. You may still run **Internal testing** first as a smoke test, then create the
**Production** release and **Send for review**. First review for a new developer can take several
days to a few weeks.
