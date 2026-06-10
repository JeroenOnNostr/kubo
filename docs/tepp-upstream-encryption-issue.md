# Upstream issue draft — encrypt permission/blacklist/global list contents (privacy)

> Paste-ready draft for the TEPP upstream repo
> (`nostr://npub10av9rgt…/relay.ngit.dev/tepp`, see memory `gitworkshop-ngit.md`).
> This is KUBO-173 part (2) — the wire-format change. Part (1) (relay routing —
> confine TEPP events to a private family relay set) shipped in Kubo without an
> upstream change. Do NOT file this via automation; review and file by hand.

## Title

Encrypt permission / blacklist / global list **contents** so a relay can't read a minor's social graph and schedule

## Summary

TEPP (spec v0.1.1) describes a minor. Today the permission lists
(kinds **8710–8717**), the blacklist (**8720**), and the global restrictions
(**8721**, including the allowed-time windows) carry their data as **plaintext
tags** (`p` / `r` / `e` entries, time-window values). The kid-signed
association (**17700**) names the guardian in plaintext, and the state event
(**34700**) only encrypts the *ref ids* of a private section whose target
events are themselves public.

Net effect: anyone who can read the relay — the relay operator included — can
reconstruct, for a specific minor:

- the complete **allow-list** (who the kid may see / interact with) — the
  minor's social graph;
- the complete **block-list** (8720);
- the **daily schedule** (8721 allowed-time windows) — when the child is online.

Confining these events to a private relay (what we did client-side) keeps them
off the broad public fan-out, but the relay operator still sees plaintext, and
any misconfiguration re-exposes everything. The contents themselves should be
encrypted.

## Proposal

Move the list **contents** into **NIP-44**-encrypted event `content`, encrypted
with the **parent↔kid conversation key** (the same symmetric key the 34700
private section already uses), keeping only the `d` tag (and the minimal routing
tags a relay needs) in plaintext:

- **8710–8717 / 8720 / 8721**: the `p` / `r` / `e` entries and time-window
  values move from plaintext tags into the NIP-44-encrypted `content`. The
  envelope stays a valid Nostr event; only the addressing/`d` tag is public.
- **17700**: out of scope for this proposal — it must stay verifiable by the
  relay/clients as a kid-signed association, but it need not name the guardian
  in the clear; a follow-up could move the guardian pointer into encrypted
  content with a public commitment. Note it, don't block on it.

### Version tagging (parser-detectable)

Bump the spec to **v0.2** and tag each affected event with a version marker
(e.g. a `["tepp", "0.2"]` tag, or a content-format discriminator) so parsers can
detect encrypted-content events and fall back to the v0.1.1 plaintext path for
older events. Construct assembly must accept a mix of both during the migration
window. Clients without the conversation key (i.e. anyone who is not the parent
or the kid) simply cannot read the lists — which is the goal.

## Why this needs to be upstream

This is a **wire-format change** to shared, signed event kinds. Shipping it
unilaterally in one client would publish events other TEPP implementations can't
parse, silently breaking cross-client constructs. It must land as a spec version
bump with a documented detection/fallback path so all implementers can adopt it
on the same format.

## References

- TEPP spec **v0.1.1** — kind allocation (17700, 34700, 8710–8717, 8720, 8721).
- Vendored core: `src/lib/tepp/` (Kubo, upstream commit `c770e74`).
- Plaintext list builders: `buildEvents.ts` (`p`/`r`/`e` tags).
- Kubo client-side part (1): kind-aware relay routing
  (`src/components/NostrProvider.tsx` eventRouter + `src/lib/tepp-adapters/familyRelays.ts`).
