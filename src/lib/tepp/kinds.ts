/**
 * TEPP v0.1.1 event-kind allocation.
 * v0.1 placeholder kinds (10700 / 30700 / 1710..1721) had collisions with
 * existing usage; the v0.1.1 reallocation below was empirically verified
 * clean across damus.io, nos.lol, primal.net, snort.social, and nostr.wine.
 */

export const KIND_ASSOCIATION = 17700 // replaceable (10000-19999 per NIP-01)
export const KIND_STATE = 34700 // addressable (30000-39999 per NIP-01)

// Permission events (regular, 1000-9999 per NIP-01).
export const KIND_PERMISSION_INTERACTION_NPUB_A = 8710
export const KIND_PERMISSION_INTERACTION_NPUB_B = 8711
export const KIND_PERMISSION_VIEW_NPUB_A = 8712
export const KIND_PERMISSION_VIEW_NPUB_B = 8713
export const KIND_PERMISSION_INTERACTION_RELAY = 8714
export const KIND_PERMISSION_VIEW_RELAY = 8715
export const KIND_PERMISSION_INTERACTION_EVENT = 8716
export const KIND_PERMISSION_VIEW_EVENT = 8717

export const KIND_BLACKLIST = 8720
export const KIND_GLOBAL_RESTRICTION = 8721

export const PERMISSION_KINDS = [
  KIND_PERMISSION_INTERACTION_NPUB_A,
  KIND_PERMISSION_INTERACTION_NPUB_B,
  KIND_PERMISSION_VIEW_NPUB_A,
  KIND_PERMISSION_VIEW_NPUB_B,
  KIND_PERMISSION_INTERACTION_RELAY,
  KIND_PERMISSION_VIEW_RELAY,
  KIND_PERMISSION_INTERACTION_EVENT,
  KIND_PERMISSION_VIEW_EVENT,
] as const
export type PermissionKind = (typeof PERMISSION_KINDS)[number]

/** Extension `extend` tags MAY only target these kinds (NIP §Extension tag). */
export const EXTEND_TARGET_KINDS = [
  KIND_PERMISSION_INTERACTION_NPUB_A,
  KIND_PERMISSION_VIEW_NPUB_A,
  KIND_PERMISSION_INTERACTION_RELAY,
  KIND_PERMISSION_VIEW_RELAY,
  KIND_PERMISSION_INTERACTION_EVENT,
  KIND_PERMISSION_VIEW_EVENT,
] as const

/** Mode-A npub-list permission kinds. */
export const MODE_A_NPUB_KINDS = [
  KIND_PERMISSION_INTERACTION_NPUB_A,
  KIND_PERMISSION_VIEW_NPUB_A,
] as const

/** Mode-B npub-list permission kinds. */
export const MODE_B_NPUB_KINDS = [
  KIND_PERMISSION_INTERACTION_NPUB_B,
  KIND_PERMISSION_VIEW_NPUB_B,
] as const

/** Interaction-mode kinds (carry monitor-relay tags). */
export const INTERACTION_KINDS = [
  KIND_PERMISSION_INTERACTION_NPUB_A,
  KIND_PERMISSION_INTERACTION_NPUB_B,
  KIND_PERMISSION_INTERACTION_RELAY,
  KIND_PERMISSION_INTERACTION_EVENT,
] as const

/** View-only kinds (must NOT carry monitor-relay tags). */
export const VIEW_KINDS = [
  KIND_PERMISSION_VIEW_NPUB_A,
  KIND_PERMISSION_VIEW_NPUB_B,
  KIND_PERMISSION_VIEW_RELAY,
  KIND_PERMISSION_VIEW_EVENT,
] as const

export function kindLabel(kind: number): string {
  switch (kind) {
    case KIND_ASSOCIATION: return 'Association'
    case KIND_STATE: return 'State'
    case KIND_PERMISSION_INTERACTION_NPUB_A: return 'Permission · Interaction npub-list (mode A)'
    case KIND_PERMISSION_INTERACTION_NPUB_B: return 'Permission · Interaction npub-list (mode B)'
    case KIND_PERMISSION_VIEW_NPUB_A: return 'Permission · View-only npub-list (mode A)'
    case KIND_PERMISSION_VIEW_NPUB_B: return 'Permission · View-only npub-list (mode B)'
    case KIND_PERMISSION_INTERACTION_RELAY: return 'Permission · Interaction relay-list'
    case KIND_PERMISSION_VIEW_RELAY: return 'Permission · View-only relay-list'
    case KIND_PERMISSION_INTERACTION_EVENT: return 'Permission · Interaction event-list'
    case KIND_PERMISSION_VIEW_EVENT: return 'Permission · View-only event-list'
    case KIND_BLACKLIST: return 'Blacklist'
    case KIND_GLOBAL_RESTRICTION: return 'Global restriction'
    default: return `kind ${kind}`
  }
}
