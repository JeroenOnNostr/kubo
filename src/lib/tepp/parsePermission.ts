import type { Event } from 'nostr-tools/core'
import { verifyEvent } from 'nostr-tools/pure'
import type {
  EventPermissionItem,
  ExtendPair,
  NpubPermissionItem,
  ParsedPermission,
  RestrictionTag,
} from './types'
import {
  INTERACTION_KINDS,
  PERMISSION_KINDS,
  VIEW_KINDS,
  EXTEND_TARGET_KINDS,
  KIND_PERMISSION_INTERACTION_NPUB_A,
  KIND_PERMISSION_INTERACTION_NPUB_B,
  KIND_PERMISSION_VIEW_NPUB_A,
  KIND_PERMISSION_VIEW_NPUB_B,
  KIND_PERMISSION_INTERACTION_RELAY,
  KIND_PERMISSION_VIEW_RELAY,
  KIND_PERMISSION_INTERACTION_EVENT,
  KIND_PERMISSION_VIEW_EVENT,
} from './kinds'
import { tryParseRestrictionTag } from './restrictions'

const NPUB_KINDS = [
  KIND_PERMISSION_INTERACTION_NPUB_A,
  KIND_PERMISSION_INTERACTION_NPUB_B,
  KIND_PERMISSION_VIEW_NPUB_A,
  KIND_PERMISSION_VIEW_NPUB_B,
] as const
const RELAY_KINDS = [KIND_PERMISSION_INTERACTION_RELAY, KIND_PERMISSION_VIEW_RELAY] as const
const EVENT_KINDS = [KIND_PERMISSION_INTERACTION_EVENT, KIND_PERMISSION_VIEW_EVENT] as const

export function parsePermission(raw: Event): ParsedPermission {
  const parseProblems: string[] = []

  if (!(PERMISSION_KINDS as readonly number[]).includes(raw.kind)) {
    parseProblems.push(`Not a TEPP permission kind: ${raw.kind}`)
  }

  const subjectTag = raw.tags.find((t) => t[0] === 'subject')
  const subject = subjectTag?.[1]?.toLowerCase()

  // Items by category
  const npubItems: NpubPermissionItem[] = []
  const relayItems: string[] = []
  const eventItems: EventPermissionItem[] = []

  if ((NPUB_KINDS as readonly number[]).includes(raw.kind)) {
    for (const t of raw.tags) {
      if (t[0] !== 'p') continue
      if (!t[1] || !/^[a-f0-9]{64}$/i.test(t[1])) {
        parseProblems.push(`Bad p-tag pubkey: ${t[1]}`)
        continue
      }
      const isInteractionKind = (INTERACTION_KINDS as readonly number[]).includes(raw.kind)
      npubItems.push({
        pubkey: t[1].toLowerCase(),
        interactionRelayHint: isInteractionKind ? t[2] : undefined,
      })
    }
  } else if ((RELAY_KINDS as readonly number[]).includes(raw.kind)) {
    for (const t of raw.tags) {
      if (t[0] !== 'r' || !t[1]) continue
      relayItems.push(t[1])
    }
  } else if ((EVENT_KINDS as readonly number[]).includes(raw.kind)) {
    for (const t of raw.tags) {
      if (t[0] !== 'e' || !t[1]) continue
      eventItems.push({ eventId: t[1].toLowerCase(), relayHint: t[2] })
    }
  }

  // Restrictions
  const restrictions: RestrictionTag[] = []
  for (const t of raw.tags) {
    if (t[0] !== 'restriction') continue
    const r = tryParseRestrictionTag(t)
    if (r) restrictions.push(r)
    else parseProblems.push(`Bad restriction tag: ${t.slice(1).join(',')}`)
  }

  // Monitor relays — only valid on interaction kinds.
  const monitorRelays: string[] = []
  for (const t of raw.tags) {
    if (t[0] !== 'monitor-relay' || !t[1]) continue
    if (!(INTERACTION_KINDS as readonly number[]).includes(raw.kind)) {
      parseProblems.push('monitor-relay tag on a view-only kind (must not appear)')
      continue
    }
    monitorRelays.push(t[1])
  }

  // Extension tag (at most one).
  const extendTags = raw.tags.filter((t) => t[0] === 'extend')
  if (extendTags.length > 1) {
    parseProblems.push(`Multiple extend tags (${extendTags.length}); only one is permitted`)
  }
  const extendPairs: ExtendPair[] = []
  if (extendTags[0]) {
    const pairs = extendTags[0].slice(1)
    for (const pair of pairs) {
      const m = /^(\d+):(as-is|to-view)$/.exec(pair)
      if (!m) {
        parseProblems.push(`Bad extend pair: "${pair}" (must be "<kind>:as-is" or "<kind>:to-view")`)
        continue
      }
      const k = Number(m[1])
      const mutation = m[2] as 'as-is' | 'to-view'
      // Per NIP §Extension tag: kinds MUST be mode-A targets.
      if (!(EXTEND_TARGET_KINDS as readonly number[]).includes(k)) {
        parseProblems.push(
          `extend kind ${k} is not a mode-A target (mode-B kinds 8711/8713 are explicitly forbidden); engine ignores`,
        )
        continue
      }
      // to-view requires the source kind to be an interaction kind.
      if (mutation === 'to-view' && (VIEW_KINDS as readonly number[]).includes(k)) {
        parseProblems.push(`to-view applied to view-only kind ${k} is invalid; engine ignores`)
        continue
      }
      extendPairs.push({ kind: k, mutation })
    }
  }

  let signatureValid = false
  try {
    signatureValid = verifyEvent(raw)
  } catch {
    signatureValid = false
  }

  return {
    raw,
    kind: raw.kind,
    guardian: raw.pubkey.toLowerCase(),
    subject,
    npubItems,
    relayItems,
    eventItems,
    restrictions,
    monitorRelays,
    extendPairs,
    signatureValid,
    parseProblems,
  }
}
