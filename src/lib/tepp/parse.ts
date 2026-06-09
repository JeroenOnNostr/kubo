import type { Event } from 'nostr-tools/core'
import { verifyEvent } from 'nostr-tools/pure'
import type { ParsedAssociation, Guardian } from './types'
import { KIND_ASSOCIATION } from './kinds'

/** Parse a raw kind-10700 event into the structured association form. */
export function parseAssociation(raw: Event): ParsedAssociation {
  const parseProblems: string[] = []

  if (raw.kind !== KIND_ASSOCIATION) {
    parseProblems.push(`Wrong kind: ${raw.kind}, expected ${KIND_ASSOCIATION}`)
  }

  const subjectTag = raw.tags.find((t) => t[0] === 'subject')
  const subject = subjectTag?.[1] ?? ''
  if (!subject) parseProblems.push('Missing required subject tag')

  const dTag = raw.tags.find((t) => t[0] === 'd')
  if (!dTag) parseProblems.push('Missing required d tag')
  else if (dTag[1] !== 'tepp-assoc')
    parseProblems.push(`d tag must be "tepp-assoc", got "${dTag[1]}"`)

  const guardians: Guardian[] = raw.tags
    .filter((t) => t[0] === 'guardian' && typeof t[1] === 'string' && /^[a-f0-9]{64}$/i.test(t[1]))
    .map((t) => ({ pubkey: t[1].toLowerCase(), relayHint: t[2] }))
  if (guardians.length === 0) parseProblems.push('No guardian tags found')

  const expirationTag = raw.tags.find((t) => t[0] === 'expiration')
  const expirationStr = expirationTag?.[1]
  const expiration = expirationStr ? Number(expirationStr) : NaN
  if (!expirationTag) parseProblems.push('Missing required expiration tag')
  else if (Number.isNaN(expiration)) parseProblems.push('expiration tag value is not a number')

  const now = Math.floor(Date.now() / 1000)
  const expired = !Number.isNaN(expiration) && expiration < now

  // verifyEvent is the costly one; only run if structure is roughly OK.
  let signatureValid = false
  try {
    signatureValid = verifyEvent(raw)
  } catch {
    signatureValid = false
  }

  const subjectMatchesPubkey = subject.toLowerCase() === raw.pubkey.toLowerCase()
  if (subject && !subjectMatchesPubkey)
    parseProblems.push('subject tag does not match event pubkey (v0.1 PoC requires they match)')

  return {
    raw,
    subject: subject.toLowerCase(),
    guardians,
    expiration,
    validity: {
      signatureValid,
      subjectMatchesPubkey,
      expired,
      expiresAtIso: Number.isNaN(expiration)
        ? '—'
        : new Date(expiration * 1000).toISOString(),
      parseProblems,
    },
  }
}

/**
 * Pick the "current valid" association from a list of candidates: the latest
 * by created_at that passes signature, subject==pubkey, and is not expired.
 * Returns null if none qualify.
 */
export function pickCurrentAssociation(events: Event[]): ParsedAssociation | null {
  const parsed = events.map(parseAssociation)
  const valid = parsed.filter(
    (p) => p.validity.signatureValid && p.validity.subjectMatchesPubkey && !p.validity.expired,
  )
  if (valid.length === 0) return null
  valid.sort((a, b) => {
    if (b.raw.created_at !== a.raw.created_at) return b.raw.created_at - a.raw.created_at
    // Tie-breaker: lex-smaller event id wins (NIP-01 convention).
    return a.raw.id.localeCompare(b.raw.id)
  })
  return valid[0]
}
