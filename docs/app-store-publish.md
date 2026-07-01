# Publishing Kubo to the Apple App Store — copy + runbook (companion to Google Play)

This is the iOS companion to `docs/google-play-publish.md` and `play-store/PLAY-PUBLISH.md`. The
**store copy here is shared with Google Play** — the same listing text was written to clear both
Apple and Google review (no competitor names, no pricing/platform words). Anywhere a field exists
on Apple but not Google, the Apple-specific value is given below.

> **Status:** copy + policy prep only. The iOS **build / signing / TestFlight** pipeline is NOT
> set up yet — it needs an Apple Developer Program account (under the Web of Trust Foundation) and
> a Mac or a cloud Mac CI (e.g. Codemagic, as used for Yenn). Treat the build section as a TODO.

---

## Audience decision (same as Play — locked)

Kubo is submitted as an **adults / parents** app, **17+**. We do **NOT** enter Apple's **Kids
Category**. Reasons, mirroring the Play "not Designed for Families" decision:

- The Kids Category is for apps whose **primary audience is children**. Kubo's operator is the
  **parent**; the child is the beneficiary of the parent's curation.
- The Kids Category bans third-party analytics and navigate-away external links and requires a
  child-appropriate age band — incompatible with Kubo connecting to an open network, linking to
  kubo.watch / weboftrustfoundation.com, and an honest 17+ rating.
- All four signals must agree, or Apple rejects the kids-adjacent framing: (1) parent-operated
  tool, (2) 17+ rating, (3) description says "designed to be operated by an adult, not configured
  by a child," (4) not in the Kids Category.

---

## App Store Connect — listing fields

| Field | Limit | Value |
|---|---|---|
| App name | 30 | `Kubo` |
| Subtitle | 30 | `Curated video for your child` (28) |
| Promotional text | 170 | `Your child's video feed, shaped by the people and creators you trust — never by an algorithm. No ads, no tracking, no endless autoplay. You decide who gets in.` (157) |
| Description | 4000 | Use `play-store/play-listing/en-US/full_description.txt` verbatim (it is Apple-safe). |
| Keywords | 100 | `parental control,kids,family,screen time,safe video,web of trust,nostr,curated,no ads,trust` (99) |
| Support URL | — | `https://kubo.watch` |
| Marketing URL (optional) | — | `https://kubo.watch` |
| Privacy Policy URL | — | `https://kubo.watch/privacy` (must be live — same page as Play) |
| Copyright | — | `2026 Web of Trust Foundation` |

**Subtitle alternatives** if you want a different angle: `Parent-curated kids' video` (26),
`Video parents choose, not bots` (30).

### Promotional vs. What's New
- **Promotional text** can be edited any time without a new build — use it for seasonal/marketing
  tweaks.
- **What's New (release notes):** for the **first** submission, use `Initial release.` For updates,
  reuse the Play release-notes block (the 2026.06.23 text in the Play answer sheet is Apple-safe).

### Do NOT use the YouTube comparison on Apple
The optional competitor-comparison sentence (allowed only in the Google full description) must
**never** appear on Apple. Apple routinely rejects listings that name a competitor's trademark or
position the app as a named competitor's "alternative." Keeping both listings textually identical
is the lowest-maintenance, lowest-risk choice.

---

## Categories

- **Primary: Education** — best high-intent fit for a parent-facing curation tool; better
  discovery/conversion than Utilities.
- **Secondary: Utilities** — honest reflection of the parental-control nature.
- (Apple has no "Parenting" category; Education + Utilities is the closest cross-store match to the
  Play "Parenting" choice.)

---

## Age rating (App Store questionnaire) → 17+

Same underlying facts as the Google IARC answers; Apple's questionnaire lands at **17+** because
unrestricted web access and/or unmoderated user-generated content each independently force the top
band.

| Apple question | Answer |
|---|---|
| Cartoon/fantasy/realistic violence | None |
| Sexual content or nudity | None |
| Profanity or crude humor | None |
| Alcohol, tobacco, or drug use | None |
| Simulated gambling | None |
| Horror/fear themes | None |
| **Unrestricted web access** | **Yes** → forces 17+ |
| **User-generated content / does the app contain UGC?** | **Yes**, with no guarantee of moderation across the open network |
| Medical/treatment info | No |
| Made for Kids | **No** (not in Kids Category) |

---

## Privacy "nutrition label" (App Privacy section)

Same facts as the Google Data Safety form:

- **Data Used to Track You:** None.
- **Data Linked to You:** None collected by the Foundation. (Published Nostr events are public by
  design, but they are user-published content on a decentralized network, not data the Foundation
  collects about the user.)
- **Data Not Linked to You:** None (no analytics, no diagnostics — the shipped build has analytics
  disabled).
- **Encryption in transit:** Yes.
- If asked about user content: the app publishes user-generated content to a public decentralized
  network at the user's direction; declare **User Content → Other User Content** with purpose
  **App Functionality**, not for tracking or ads.

> If a non-empty analytics domain is ever shipped, revisit this label and the Play Data Safety form
> together.

---

## Child safety (App Review)

- Provide the same **CSAE / child-safety standards** page: `https://kubo.watch/csae`
  (`play-store/policies/csae-policy.md`).
- In-app reporting exists (report any post/profile).
- Designated child-safety contact: **info@weboftrustfoundation.org**.
- Expect App Review to scrutinize the kids-adjacent framing vs. the 17+ rating — the parent-tool
  framing + the fail-closed curation model + the CSAE page are the answers.

---

## Build / signing / TestFlight (TODO — not yet set up)

1. Apple Developer Program enrollment under **Web of Trust Foundation** (D-U-N-S, ~$99/yr).
2. Bundle ID — recommend `watch.kubo.app` to match the Play package (or `com.kubo.app` namespace;
   Apple bundle IDs are independent of Google, pick one and keep it permanent).
3. Capacitor iOS target: `npx cap add ios` / `npx cap sync ios`, open in Xcode, set signing.
4. Build on a Mac or cloud Mac (Codemagic — see Yenn's iOS pipeline for a working pattern).
5. Upload to **App Store Connect → TestFlight**, then submit for App Review.
6. Reuse all copy + policy URLs above; the listing is already prepared.

---

## Cross-store parity checklist

- [ ] Same icon / screenshots / feature art family as Play + Zapstore (visual consistency).
- [ ] Same description text (Apple-safe version) on both stores.
- [ ] Same privacy + CSAE policy URLs (kubo.watch/privacy, kubo.watch/csae) live.
- [ ] 17+ (Apple) ⇄ Teen/Mature (Google) ratings both reflect UGC + open web honestly.
- [ ] Not in Kids Category (Apple) / not Designed for Families (Google).
- [ ] Contact `info@weboftrustfoundation.org` consistent everywhere.
