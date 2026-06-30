# Kubo — Child Safety Standards (CSAE Policy)

**Last updated: June 30, 2026**

> Publish this page at **https://kubo.watch/csae**. Google Play's Child Safety Standards policy
> requires a published, publicly reachable child-safety standards page and an in-app reporting
> mechanism for any app that surfaces user-generated content and relates to children. Provide this
> URL in the Play Console **Policy → App content → Child safety standards** section. It must
> resolve publicly (HTTP 200) before review.

## Our Commitment

Kubo, published by the **Web of Trust Foundation**, has a **zero-tolerance policy** toward child
sexual abuse and exploitation (CSAE) material. The safety of children is paramount, and we are
committed to doing everything within our power as a client application to prevent the
distribution, promotion, or facilitation of CSAE content through our app.

This policy applies to all content accessible through Kubo, including text, images, videos, links,
and any other media. It covers all forms of CSAE, including but not limited to imagery,
solicitation, grooming, trafficking, and the sexualization of minors.

## How Kubo Works

Kubo is a **client application** for the Nostr protocol, an open, decentralized communication
network. Understanding the architecture is important context for this policy:

- **Our infrastructure:** We operate the Kubo relay and Kubo Blossom file server, which serve as
  the default relay and file host for Kubo. We have full moderation control over content stored on
  these services.
- **Third-party relays:** Users may also connect to additional Nostr relays operated by
  independent third parties. Kubo fetches and renders content from whatever relays the user is
  connected to. We do not have moderation control over third-party relays, but we control what the
  app displays.
- **Third-party media servers:** Users may upload images and videos to third-party
  Blossom-compatible file servers. We do not operate or moderate these external services.

We take full responsibility for the experience within our app. On our own infrastructure we can
directly remove content and ban offending accounts. For content originating from third-party
services, we actively block it from being displayed within Kubo.

## Built for Parental Curation

Kubo is designed so that a parent or guardian, operating the app on a supervised device, decides
exactly which people, feeds, and creators a child can see. A child's feed only ever shows content
from sources the parent has explicitly admitted through Kubo's web-of-trust system. If trust
information cannot be loaded, the feed **fails closed** and shows nothing rather than falling back
to unvetted content. This curation model is a core child-safety control, not an add-on.

## Prohibited Content and Behavior

The following is strictly prohibited on Kubo. Users found engaging in any of the following will be
subject to immediate action:

- **CSAM (Child Sexual Abuse Material):** Any visual depiction of sexually explicit conduct
  involving a minor, including photographs, videos, and digitally or AI-generated images.
- **Grooming:** Any attempt to build a relationship with a minor for the purpose of sexual
  exploitation or abuse.
- **Solicitation:** Requesting, offering, or facilitating the exchange of CSAE material or sexual
  contact with minors.
- **Sexualization of minors:** Content that sexualizes minors, including suggestive or sexual
  commentary about children, even if no explicit imagery is involved.
- **Trafficking:** Any content that facilitates, promotes, or coordinates the trafficking of
  minors for sexual purposes.
- **Links and references:** Sharing links to external sites or resources containing CSAE material,
  or providing instructions on how to find or produce such material.

## Detection and Prevention

Kubo implements multiple layers of protection to combat CSAE:

- **Content filtering:** We maintain and enforce content filtering and blocklists within the app
  to block known CSAE material from being displayed, regardless of which relay it originates from.
- **User reporting:** We provide in-app reporting tools that allow users to flag suspected CSAE
  content for immediate review.
- **Kubo relay moderation:** On our own Kubo relay, we actively moderate content and will
  immediately remove any CSAE material and permanently ban associated accounts.
- **Kubo Blossom server moderation:** On our own Kubo Blossom file server, we will immediately
  delete any CSAE media and ban the uploading account.
- **Third-party relay blocking:** Third-party relays known to host or tolerate CSAE material may
  be removed from Kubo's default relay list and blocked from being added by users.
- **Mute and block tools:** Users can mute or block accounts at the client level.

## Reporting CSAE Content

If you encounter any content on Kubo that you believe constitutes child sexual abuse or
exploitation, please report it immediately:

- **In-app reporting:** Use the report button available on any post or user profile to flag
  content for review.
- **Contact us directly:** Email the Web of Trust Foundation at **info@weboftrustfoundation.org**
  with details of the content, including any relevant Nostr event IDs or public keys.
- **Report to NCMEC:** You can also file a report directly with the
  [NCMEC CyberTipline](https://www.missingkids.org/gethelpnow/cybertipline).
- **Contact law enforcement:** If you believe a child is in immediate danger, contact your local
  law enforcement immediately.

All reports of CSAE content are treated with the highest priority and reviewed as quickly as
possible.

## Enforcement Actions

When CSAE content or behavior is identified, Kubo will, as applicable: block the content from
rendering in the app; delete it from the Kubo relay and Blossom server and permanently ban the
associated accounts; add offending public keys to app-level blocklists; block non-compliant
third-party relays; and report identified CSAE material to the
[NCMEC CyberTipline](https://www.missingkids.org/gethelpnow/cybertipline) and applicable law
enforcement agencies.

## Cooperation with Law Enforcement

The Web of Trust Foundation cooperates fully with law enforcement agencies investigating CSAE. We
will provide information available to us from the Kubo relay and Blossom server in accordance with
applicable law, identify the specific relay and file-server URLs where offending content was
observed, preserve available evidence upon a valid legal request, and report identified CSAE
material to NCMEC proactively.

## Designated Child-Safety Contact

The point of contact for child-safety matters, CSAE reports, and questions about this policy is:

**Web of Trust Foundation — Child Safety**
Email: **info@weboftrustfoundation.org**
Website: [weboftrustfoundation.com](https://weboftrustfoundation.com)

## Changes to This Policy

We may update this child safety policy as our tools, processes, and the Nostr ecosystem evolve.
Changes will be reflected on this page with an updated date.
