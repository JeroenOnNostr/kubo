import type { Event } from 'nostr-tools/core'
import { verifyEvent } from 'nostr-tools/pure'
import { KIND_STATE } from './kinds'
import type { ParsedState, PermissionRef } from './types'

/** Parse a raw kind-30700 event into the structured public-section state. */
export function parseState(raw: Event): ParsedState {
  const parseProblems: string[] = []

  if (raw.kind !== KIND_STATE) {
    parseProblems.push(`Wrong kind: ${raw.kind}, expected ${KIND_STATE}`)
  }

  const dTag = raw.tags.find((t) => t[0] === 'd')
  const subjectTag = raw.tags.find((t) => t[0] === 'subject')
  const subject = (subjectTag?.[1] ?? dTag?.[1] ?? '').toLowerCase()
  if (!dTag) parseProblems.push('Missing required d tag')
  if (!subjectTag) parseProblems.push('Missing required subject tag')
  if (subject && !/^[a-f0-9]{64}$/i.test(subject))
    parseProblems.push(`subject value is not a 64-char hex pubkey: ${subject}`)

  const assocTag = raw.tags.find((t) => t[0] === 'assoc')
  const publicAssoc = assocTag?.[1]

  const blacklistTag = raw.tags.find((t) => t[0] === 'blacklist')
  const publicBlacklistRef = blacklistTag?.[1]

  const globalTag = raw.tags.find((t) => t[0] === 'global')
  const publicGlobalRef = globalTag?.[1]

  const publicPermissions: PermissionRef[] = raw.tags
    .filter((t) => t[0] === 'permission' && t[1] && t[2])
    .map((t) => ({
      id: t[1],
      kind: Number(t[2]),
      relayHint: t[3],
    }))
    .filter((p) => Number.isFinite(p.kind))

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
    publicAssoc,
    publicBlacklistRef,
    publicGlobalRef,
    publicPermissions,
    privateDecryptStatus: 'not-attempted',
    parseProblems,
    signatureValid,
  }
}

/**
 * Pick the latest valid state event from a list of candidates, given the
 * subject's *current* guardian set. Latest by created_at; tie-break by
 * lex-smaller event id (NIP-01 convention). Per Q-2 (resolved):
 * guardianship is evaluated NOW, not at the state event's created_at.
 */
export function pickCurrentState(
  candidates: Event[],
  currentGuardianSet: Set<string>,
): { current: ParsedState; rejected: ParsedState[] } | null {
  const parsed = candidates.map(parseState)
  const ofValidGuardian = parsed.filter(
    (p) => p.signatureValid && currentGuardianSet.has(p.guardian),
  )
  const rejected = parsed.filter((p) => !ofValidGuardian.includes(p))

  if (ofValidGuardian.length === 0) return null

  ofValidGuardian.sort((a, b) => {
    if (b.raw.created_at !== a.raw.created_at) return b.raw.created_at - a.raw.created_at
    return a.raw.id.localeCompare(b.raw.id)
  })
  return { current: ofValidGuardian[0], rejected }
}
