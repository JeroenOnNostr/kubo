import type {
  Construct,
  ConstructEntry,
  ParsedAssociation,
  ParsedBlacklist,
  ParsedGlobal,
  ParsedPermission,
  ParsedState,
} from '@/lib/tepp/types';

/**
 * Synchronous direct-entries assembly. Mirror of the v0.1 PoC upstream
 * `assembleConstruct` (tepp-webapp/src/tepp/construct.ts), reimplemented
 * here so Kubo owns the orchestration boundary. Pure logic — no relay
 * fetches, no signer interaction. Use [useConstruct.ts](./useConstruct.ts)
 * for the React-side fetch + assemble pipeline.
 *
 * Extension resolution (single-hop) is NOT included here in v1 — the PoC
 * extension resolver in upstream depends on the pool, and the simpler
 * direct-only path covers the Kubo UI tier mapping (extend → 8710 with an
 * extend tag). When extension fetch lands, it goes in
 * `resolveExtensionsAdapter()` alongside this function.
 */
export function assembleConstruct(input: {
  assoc: ParsedAssociation;
  state: ParsedState;
  permissions: ParsedPermission[];
  blacklist?: ParsedBlacklist;
  global?: ParsedGlobal;
}): Construct {
  const { assoc, state: _state, permissions, blacklist, global } = input;
  const guardians = assoc.guardians.map((g) => g.pubkey.toLowerCase());

  // KUBO-156: deny-lists must be signed by a current guardian to take effect.
  // The parsers compute `signatureValid` and `guardian` on every event but the
  // assembly previously forwarded blacklist/global unconditionally (the fields
  // were dead code). A forged or non-guardian deny-list event handed over by a
  // sloppy/hostile relay must NOT silently drop into the construct — but note
  // these are *deny*-lists, so dropping a forged one is fail-OPEN. The real
  // fail-closed guarantee lives in useConstruct.ts: when the state *references*
  // a blacklist/global id and the fetched event is missing/wrong/forged, the
  // whole construct is withheld (reason 'fetch-failed'). Here we additionally
  // refuse to honour a verified-but-non-guardian event that somehow reached
  // this layer.
  const verifiedBlacklist =
    blacklist && blacklist.signatureValid && guardians.includes(blacklist.guardian)
      ? blacklist
      : undefined;
  const verifiedGlobal =
    global && global.signatureValid && guardians.includes(global.guardian)
      ? global
      : undefined;

  const entries: ConstructEntry[] = permissions
    .filter((p) => p.signatureValid && guardians.includes(p.guardian))
    .map((p) => ({
      kind: p.kind,
      sourceEventId: p.raw.id,
      source: 'direct' as const,
      items:
        p.npubItems.length > 0
          ? p.npubItems
          : p.relayItems.length > 0
            ? p.relayItems
            : p.eventItems,
      restrictions: p.restrictions,
      monitorRelays: p.monitorRelays,
    }));

  const inertAuditFindings: string[] = [];
  for (const p of permissions) {
    for (const item of p.npubItems) {
      if (verifiedBlacklist?.blockedPubkeys.includes(item.pubkey)) {
        inertAuditFindings.push(
          `Permission ${p.raw.id.slice(0, 12)}… (kind ${p.kind}) lists pubkey ${item.pubkey.slice(0, 10)}… which is currently blacklisted`,
        );
      }
    }
    for (const r of p.relayItems) {
      if (verifiedBlacklist?.blockedRelays.includes(r)) {
        inertAuditFindings.push(
          `Permission ${p.raw.id.slice(0, 12)}… (kind ${p.kind}) lists relay ${r} which is currently blacklisted`,
        );
      }
    }
    for (const e of p.eventItems) {
      if (verifiedBlacklist?.blockedEvents.includes(e.eventId)) {
        inertAuditFindings.push(
          `Permission ${p.raw.id.slice(0, 12)}… (kind ${p.kind}) lists event ${e.eventId.slice(0, 10)}… which is currently blacklisted`,
        );
      }
    }
  }

  return {
    subject: assoc.subject,
    guardians,
    blacklist: verifiedBlacklist,
    global: verifiedGlobal,
    entries,
    extensionTraces: [],
    inertAuditFindings,
  };
}
