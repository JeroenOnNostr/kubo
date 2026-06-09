import type { EventTemplate } from 'nostr-tools/core'
import * as nip19 from 'nostr-tools/nip19'
import {
  KIND_ASSOCIATION,
  KIND_BLACKLIST,
  KIND_GLOBAL_RESTRICTION,
  KIND_STATE,
} from './kinds'
import type { PermissionRef, RestrictionTag } from './types'

export interface GuardianDraft {
  pubkey: string // hex
  relayHint?: string
}

/**
 * Build the unsigned association-event template (NIP §Association event,
 * v0.1 PoC: subject signs alone). The signer's pubkey becomes both the
 * event's pubkey AND the value of the `subject` tag.
 */
export function buildAssociationTemplate(opts: {
  subject: string // hex
  guardians: GuardianDraft[]
  expirationSeconds: number // unix seconds (absolute time)
}): EventTemplate {
  const tags: string[][] = [
    ['d', 'tepp-assoc'],
    ['subject', opts.subject.toLowerCase()],
    ...opts.guardians.map((g) =>
      g.relayHint
        ? ['guardian', g.pubkey.toLowerCase(), g.relayHint]
        : ['guardian', g.pubkey.toLowerCase()],
    ),
    ['expiration', String(opts.expirationSeconds)],
  ]
  return {
    kind: KIND_ASSOCIATION,
    content: '',
    tags,
    created_at: Math.floor(Date.now() / 1000),
  }
}

/**
 * Accept either an npub1… or 64-char hex string. Throw if neither.
 * Returns the lowercase hex pubkey.
 */
export function parsePubkeyInput(input: string): string {
  const trimmed = input.trim()
  if (trimmed.startsWith('npub1')) {
    const decoded = nip19.decode(trimmed)
    if (decoded.type !== 'npub') throw new Error('Not an npub')
    return decoded.data
  }
  if (/^[a-f0-9]{64}$/i.test(trimmed)) return trimmed.toLowerCase()
  throw new Error('Expected an npub1… or 64-char hex pubkey')
}

/**
 * The a-tag pointing at a subject's current association event. In NIP-01
 * a-tag form: `<kind>:<author>:<d-identifier>`. For TEPP, that's always
 * `17700:<subject-pubkey>:tepp-assoc`.
 */
export function buildAssocATag(subject: string): string {
  return `${KIND_ASSOCIATION}:${subject.toLowerCase()}:tepp-assoc`
}

/** Plaintext shape of the state-event private section per NIP §State event. */
export interface StatePrivateSection {
  blacklist?: string
  global?: string
  permissions: PermissionRef[]
}

/**
 * Build the unsigned state-event template. The caller provides the
 * already-encrypted private-section ciphertext (produced via the signer's
 * NIP-44 v2 encrypt to the subject pubkey).
 */
export function buildStateTemplate(opts: {
  subject: string // hex
  publicAssocATag?: string
  publicBlacklistRef?: string
  publicGlobalRef?: string
  publicPermissions?: PermissionRef[]
  encryptedContent: string // NIP-44 v2 ciphertext
}): EventTemplate {
  const tags: string[][] = [
    ['d', opts.subject.toLowerCase()],
    ['subject', opts.subject.toLowerCase()],
  ]
  if (opts.publicAssocATag) tags.push(['assoc', opts.publicAssocATag])
  if (opts.publicBlacklistRef) tags.push(['blacklist', opts.publicBlacklistRef])
  if (opts.publicGlobalRef) tags.push(['global', opts.publicGlobalRef])
  for (const p of opts.publicPermissions ?? []) {
    tags.push(
      p.relayHint
        ? ['permission', p.id, String(p.kind), p.relayHint]
        : ['permission', p.id, String(p.kind)],
    )
  }
  return {
    kind: KIND_STATE,
    content: opts.encryptedContent,
    tags,
    created_at: Math.floor(Date.now() / 1000),
  }
}

/* -------------------------------------------------------------------------- */
/* Permission / blacklist / global builders                                   */
/* -------------------------------------------------------------------------- */

export function buildPermissionTemplate(opts: {
  kind: number
  subject?: string
  dIdentifier: string // recommended: <subject>:<scope>:<mode>:<sequence> or arbitrary
  npubItems?: { pubkey: string; interactionRelayHint?: string }[]
  relayItems?: string[]
  eventItems?: { eventId: string; relayHint?: string }[]
  restrictionTags?: string[][] // already-serialised wire form
  monitorRelays?: string[]
  extendPairs?: { kind: number; mutation: 'as-is' | 'to-view' }[]
}): EventTemplate {
  const tags: string[][] = [['d', opts.dIdentifier]]
  if (opts.subject) tags.push(['subject', opts.subject.toLowerCase()])
  for (const p of opts.npubItems ?? []) {
    tags.push(
      p.interactionRelayHint
        ? ['p', p.pubkey.toLowerCase(), p.interactionRelayHint]
        : ['p', p.pubkey.toLowerCase()],
    )
  }
  for (const r of opts.relayItems ?? []) tags.push(['r', r])
  for (const e of opts.eventItems ?? []) {
    tags.push(e.relayHint ? ['e', e.eventId, e.relayHint] : ['e', e.eventId])
  }
  for (const t of opts.restrictionTags ?? []) tags.push(t)
  for (const m of opts.monitorRelays ?? []) tags.push(['monitor-relay', m])
  if (opts.extendPairs && opts.extendPairs.length > 0) {
    tags.push(['extend', ...opts.extendPairs.map((p) => `${p.kind}:${p.mutation}`)])
  }
  return {
    kind: opts.kind,
    content: '',
    tags,
    created_at: Math.floor(Date.now() / 1000),
  }
}

export function buildBlacklistTemplate(opts: {
  subject?: string
  dIdentifier: string
  pubkeys?: string[]
  relays?: string[]
  eventIds?: string[]
}): EventTemplate {
  const tags: string[][] = [['d', opts.dIdentifier]]
  if (opts.subject) tags.push(['subject', opts.subject.toLowerCase()])
  for (const p of opts.pubkeys ?? []) tags.push(['p', p.toLowerCase()])
  for (const r of opts.relays ?? []) tags.push(['r', r])
  for (const e of opts.eventIds ?? []) tags.push(['e', e.toLowerCase()])
  return {
    kind: KIND_BLACKLIST,
    content: '',
    tags,
    created_at: Math.floor(Date.now() / 1000),
  }
}

export function buildGlobalRestrictionTemplate(opts: {
  subject?: string
  dIdentifier: string
  restrictionTags?: string[][]
}): EventTemplate {
  const tags: string[][] = [['d', opts.dIdentifier]]
  if (opts.subject) tags.push(['subject', opts.subject.toLowerCase()])
  for (const t of opts.restrictionTags ?? []) tags.push(t)
  return {
    kind: KIND_GLOBAL_RESTRICTION,
    content: '',
    tags,
    created_at: Math.floor(Date.now() / 1000),
  }
}

/** Render a RestrictionTag back to wire form for inclusion in a builder. */
export function restrictionTagToWire(r: RestrictionTag): string[] {
  return r.raw.slice()
}

/** Build a restriction tag from form fields (returns wire form). */
export function buildRestrictionTagWire(opts: {
  polarity: 'allow' | 'deny'
  kindList: string // comma-separated nums or "*"
  weekday: string // "1,2,3" or "*"
  timeRange: string // "HH:MM-HH:MM" or "*"
}): string[] {
  return [
    'restriction',
    opts.polarity,
    opts.kindList || '*',
    opts.weekday || '*',
    opts.timeRange || '*',
  ]
}
