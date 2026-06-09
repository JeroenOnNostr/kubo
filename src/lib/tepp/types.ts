import type { Event } from 'nostr-tools/core'

/**
 * Parsed TEPP events. Each carries the original raw event so the UI can
 * display the wire form alongside the structured interpretation.
 */

export interface PermissionRef {
  id: string // event id hex
  kind: number
  relayHint?: string
}

export interface Guardian {
  pubkey: string // hex
  relayHint?: string
}

export interface ParsedAssociation {
  raw: Event
  subject: string // hex
  guardians: Guardian[]
  expiration: number // unix seconds
  // Validation findings — null/undefined values mean "not checked".
  validity: AssociationValidity
}

export interface AssociationValidity {
  signatureValid: boolean
  subjectMatchesPubkey: boolean
  expired: boolean
  expiresAtIso: string
  // Raised on parse: missing tags etc. Empty if structurally OK.
  parseProblems: string[]
}

export interface RestrictionTag {
  polarity: 'allow' | 'deny'
  kindList: number[] | 'any' // 'any' = wire form `*`
  weekdays: number[] | 'any' // ISO 1-7
  timeRange: TimeRange | 'any'
  raw: string[] // original tag for display
}

export interface TimeRange {
  startMinutes: number // minutes since 00:00
  endMinutes: number
  // start <= end → same-day window; start > end → wraps over midnight
}

export interface NpubPermissionItem {
  pubkey: string
  interactionRelayHint?: string
}

export interface EventPermissionItem {
  eventId: string
  relayHint?: string
}

export interface ExtendPair {
  kind: number
  mutation: 'as-is' | 'to-view'
}

export interface ParsedPermission {
  raw: Event
  kind: number
  guardian: string
  subject?: string
  npubItems: NpubPermissionItem[]
  relayItems: string[]
  eventItems: EventPermissionItem[]
  restrictions: RestrictionTag[]
  monitorRelays: string[]
  extendPairs: ExtendPair[]
  signatureValid: boolean
  parseProblems: string[]
}

export interface ParsedBlacklist {
  raw: Event
  guardian: string
  subject?: string
  blockedPubkeys: string[]
  blockedRelays: string[]
  blockedEvents: string[]
  signatureValid: boolean
  parseProblems: string[]
}

export interface ParsedGlobal {
  raw: Event
  guardian: string
  subject?: string
  restrictions: RestrictionTag[]
  signatureValid: boolean
  parseProblems: string[]
}

export interface ConstructEntry {
  kind: number
  sourceEventId: string // for direct: the entry's source event; for extension: the issuing permission event
  source: 'direct' | 'extension'

  // Extension-only fields. Provenance per NIP §Provenance:
  // [issuing-event-id, list-item-identifier, harvested-event-id]
  extensionListItem?: string // pubkey or relay URL of the listed item I
  extensionMode?: 'A' | 'B' | 'relay'
  harvestedEventId?: string
  harvestedRestrictions?: RestrictionTag[]
  mutationApplied?: 'as-is' | 'to-view'

  items: NpubPermissionItem[] | string[] | EventPermissionItem[]
  // For direct: the entry's restrictions.
  // For extension: R_issuing (NIP §Restriction inheritance — both R_issuing
  // AND R_harvested apply, evaluated independently and AND-ed).
  restrictions: RestrictionTag[]
  monitorRelays: string[]
}

export interface ExtensionTrace {
  issuingEventId: string
  issuingKind: number
  listItem: string // pubkey hex or relay URL
  mode: 'A' | 'B' | 'relay'
  status:
    | 'success'
    | 'no-association' // mode A: I has no current valid association
    | 'no-state-event' // no usable state event for I
    | 'no-permissions' // state event has no extending-kind permissions
    | 'no-target-pubkey-mode-b' // mode-B mismatch: harvested event not signed by I
    | 'self-skip' // I is already a guardian of subject
    | 'error'
  errorMessage?: string
  associationEventId?: string
  guardiansOfTarget?: string[]
  harvestedStateEventIds?: string[]
  acceptedPermissions: string[] // event ids
  rejectedPermissions: string[] // event ids with reasons
  rejectedReasons: string[]
  mutationsApplied: { sourceKind: number; targetKind: number; mutation: 'as-is' | 'to-view' }[]
  entriesCreated: number
}

export interface Construct {
  subject: string
  guardians: string[]
  blacklist?: ParsedBlacklist
  global?: ParsedGlobal
  entries: ConstructEntry[]
  extensionTraces: ExtensionTrace[]
  inertAuditFindings: string[]
}

export type Direction = 'outgoing' | 'incoming'

export interface DecisionTrace {
  result: 'permit' | 'deny'
  layer: 'blacklist' | 'global' | 'permission' | 'no-permission'
  decidingEventId?: string
  decidingTag?: string[]
  message: string
  steps: DecisionStep[]
}

export interface DecisionStep {
  layer: 'blacklist' | 'global' | 'permission'
  outcome: 'pass' | 'deny' | 'permit' | 'no-match'
  detail: string
}

/* -------------------------------------------------------------------------- */
/* Comprehensive per-reference event evaluation (NIP §Action evaluation)       */
/* -------------------------------------------------------------------------- */

export type ReferenceLayer =
  | 'blacklist'
  | 'global'
  | 'permission-event-list'
  | 'permission-pubkey-list'
  | 'permission-relay-list'
  | 'recursion-author'
  | 'recursion-inner-refs'
  | 'subject-self'
  | 'event-not-fetched'
  | 'unadmitted'

export type ReferenceOutcome =
  | 'admit-interaction'
  | 'admit-view-only'
  | 'admit-implicit-subject'
  | 'deny'
  | 'pending-fetch'

export interface ReferenceVerdictBase {
  /** human-readable summary of the verdict for this single reference */
  message: string
  /** the layer that issued the verdict */
  layer: ReferenceLayer
  /** the construct entry (its source event id) that admitted, if any */
  decidingEntryId?: string
  /** the deciding tag for blacklist/restriction layers */
  decidingTag?: string[]
  /** for event-references: the recursive sub-trace into the referenced event */
  nested?: FullEventVerdict
}

export interface ReferenceVerdict extends ReferenceVerdictBase {
  /** which referenceable surface this represents */
  surface: string // ReferenceSurface from references.ts; kept loose to avoid circular import
  /** original raw string (the bech32, hex, etc.) */
  raw: string
  /** what was decoded from the raw form (pubkey hex / event id / relay url / hex) */
  decoded: string
  /** kind of reference */
  refType: 'pubkey' | 'event' | 'relay' | 'hex-ambiguous'
  /** outcome of evaluating this reference under the active direction */
  outcome: ReferenceOutcome
}

export interface FullEventVerdict {
  result:
    | 'permit-interaction'
    | 'permit-view-only'
    | 'permit-with-redactions' // outer admits, but ≥1 nested-event reference fails
    | 'deny'
    | 'pending'
  direction: Direction
  references: ReferenceVerdict[]
  /** index into `references` of the deciding entry — first deny if any, else first admit */
  decidingIndex?: number
  /** condensed top-level summary */
  message: string
  /** kind/time of the action evaluated (for the global+restriction context) */
  evaluatedAt: { kind: number; weekday: number; minutesOfDay: number }
  /**
   * For `permit-with-redactions`: the indices of references that denied
   * (only meaningful for nested-event references whose recursion failed).
   * Renderers should mask/redact these references in the output.
   */
  redactedIndices?: number[]
}

export interface ParsedState {
  raw: Event
  guardian: string // signer pubkey
  subject: string // from `subject` or d tag
  publicAssoc?: string // value of the public-section `assoc` tag
  publicBlacklistRef?: string // event id
  publicGlobalRef?: string // event id
  publicPermissions: PermissionRef[]
  // Private section: filled in by an explicit decryption pass.
  privateDecryptStatus: 'not-attempted' | 'success' | 'failed'
  privateDecryptError?: string
  privateBlacklistRef?: string
  privateGlobalRef?: string
  privatePermissions?: PermissionRef[]
  parseProblems: string[]
  signatureValid: boolean
}
