import type { Event } from 'nostr-tools/core'
import { verifyEvent } from 'nostr-tools/pure'
import type { ParsedGlobal, RestrictionTag } from './types'
import { KIND_GLOBAL_RESTRICTION } from './kinds'
import { tryParseRestrictionTag } from './restrictions'

export function parseGlobal(raw: Event): ParsedGlobal {
  const parseProblems: string[] = []
  if (raw.kind !== KIND_GLOBAL_RESTRICTION)
    parseProblems.push(`Wrong kind ${raw.kind}, expected ${KIND_GLOBAL_RESTRICTION}`)

  const subjectTag = raw.tags.find((t) => t[0] === 'subject')
  const subject = subjectTag?.[1]?.toLowerCase()

  const restrictions: RestrictionTag[] = []
  for (const t of raw.tags) {
    if (t[0] !== 'restriction') continue
    const r = tryParseRestrictionTag(t)
    if (r) restrictions.push(r)
    else parseProblems.push(`Bad restriction tag: ${t.slice(1).join(',')}`)
  }

  // client-restriction tags are scoped out of v0.1 PoC per Q-7 (resolved).
  // Ignore them silently.

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
    restrictions,
    signatureValid,
    parseProblems,
  }
}
