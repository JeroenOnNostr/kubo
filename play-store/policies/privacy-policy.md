# Kubo — Privacy Policy

**Last updated: June 30, 2026**

> Publish this page at **https://kubo.watch/privacy**. This is the URL referenced by the
> Google Play listing and the Apple App Store privacy section, and it must resolve publicly
> (HTTP 200) before either store will accept the app for review.

## Overview

Kubo is a client application for the **Nostr protocol**, an open, decentralized communication
network. Kubo is published by the **Web of Trust Foundation**, a nonprofit based in the
Netherlands. This privacy policy explains how Kubo handles your data and what information is
shared when you use the app.

Kubo is a tool for parents. You set it up on a device you supervise and decide who and what your
child can see. It is designed to be operated by an adult.

## How Nostr Works

Nostr is a decentralized protocol. When you publish content, it is sent to one or more **relays**
(independent servers) that you choose. Kubo does not operate most of these relays and has no
control over data stored on them. Content published to Nostr relays is **public by default** and
may be visible to anyone.

## Data We Collect

Kubo is designed to minimize data collection. The published app you install does **not** include
behavioral tracking, advertising identifiers, or third-party analytics. Here is what the app
accesses:

- **Public key:** Your Nostr public key (and your child's) identifies the account. It is not
  considered private information on the Nostr network.
- **Relay connections:** The app connects to Nostr relays on your behalf to fetch and publish
  events. Relay operators — which may be third parties — can see connection metadata such as your
  IP address. Kubo does not collect or store your IP address itself.
- **Local storage:** Preferences, account information, and cached data are stored locally on your
  device. This data does not leave your device unless you explicitly publish it.
- **Published events:** Any content you publish (posts, reactions, profile updates, trust
  settings, etc.) is sent to your configured relays and becomes part of the public Nostr network.

## Children's Data

Kubo is operated by a parent or guardian on a supervised device. A child profile in Kubo is a
Nostr account whose feed is curated by the parent. Kubo does **not** require, request, or collect
a child's real name, email address, phone number, photographs of the child, precise location, or
contact lists. The Foundation does not build advertising or behavioral profiles of children. Any
content a parent or child publishes through Kubo follows the same public-by-default rules as all
Nostr content described above.

## Private Keys

Kubo manages account keys on your device and also supports signing via external signers (NIP-07).
Your private key is never transmitted to the Web of Trust Foundation and is never used for
advertising or tracking. We strongly recommend backing up your keys securely.

## Direct Messages

Direct messages on Nostr are encrypted between sender and recipient using the NIP-44 or NIP-04
encryption standards. While message content is encrypted, metadata such as the sender and
recipient public keys and timestamps are visible on relays.

## File Uploads

When you upload files (images, videos, etc.), they are sent to Blossom-compatible file servers.
These servers may be operated by third parties and may have their own privacy policies. Uploaded
files are generally publicly accessible via their URLs.

## Analytics and Advertising

The published version of Kubo contains **no analytics and no advertising**. There are no cookies,
no ad identifiers, no engagement tracking, and no third-party analytics SDKs enabled in the app
you install.

## Third-Party Services

The app may interact with the following independently operated services, each with its own data
handling practices:

- **Nostr relays** — for reading and publishing events
- **Blossom servers** — for file uploads and media hosting
- **Lightning Network / NWC** — for processing zap payments, only if you choose to use them
- **NIP-05 providers** — for verifying Nostr addresses

## Data Encryption in Transit

All connections Kubo makes to relays and servers use encrypted transport (HTTPS / secure
WebSockets). Direct messages are additionally end-to-end encrypted as described above.

## Data Removal

Because Nostr is a decentralized protocol, Kubo cannot guarantee the deletion of content once it
has been published to relays. You can request deletion by publishing a delete event (NIP-09), but
individual relays are not obligated to honor these requests. To clear local data, you can clear
the app's storage on your device or uninstall the app. For help with a removal request, contact
us using the details below.

## Changes to This Policy

We may update this privacy policy from time to time. Changes will be reflected on this page with
an updated date. Continued use of Kubo after changes constitutes acceptance of the revised policy.

## Contact

If you have questions about this privacy policy, or to make a data request, contact the Web of
Trust Foundation at **info@weboftrustfoundation.org** or visit
[weboftrustfoundation.com](https://weboftrustfoundation.com).
