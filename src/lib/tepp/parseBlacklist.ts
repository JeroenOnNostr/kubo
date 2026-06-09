import type { Event } from 'nostr-tools/core'
import { verifyEvent } from 'nostr-tools/pure'
import type { ParsedBlacklist } from './types'
import { KIND_BLACKLIST } from './kinds'

export function parseBlacklist(raw: Event): ParsedBlacklist {
  const parseProblems: string[] = []
  if (raw.kind !== KIND_BLACKLIST)
    parseProblems.push(`Wrong kind ${raw.kind}, expected ${KIND_BLACKLIST}`)

  const subjectTag = raw.tags.find((t) => t[0] === 'subject')
  const subject = subjectTag?.[1]?.toLowerCase()

  const blockedPubkeys: string[] = []
  const blockedRelays: string[] = []
  const blockedEvents: string[] = []

  for (const t of raw.tags) {
    if (t[0] === 'p' && t[1] && /^[a-f0-9]{64}$/i.test(t[1])) {
      blockedPubkeys.push(t[1].toLowerCase())
    } else if (t[0] === 'r' && t[1]) {
      blockedRelays.push(t[1])
    } else if (t[0] === 'e' && t[1] && /^[a-f0-9]{64}$/i.test(t[1])) {
      blockedEvents.push(t[1].toLowerCase())
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
    guardian: raw.pubkey.toLowerCase(),
    subject,
    blockedPubkeys,
    blockedRelays,
    blockedEvents,
    signatureValid,
    parseProblems,
  }
}
