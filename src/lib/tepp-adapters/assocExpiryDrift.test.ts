import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Lint-style structural test (KUBO-166).
 *
 * The 30-day hardcoded association TTL in `seedKidConstruct.ts` survived
 * KUBO-149 precisely because nothing forced a `buildAssociationTemplate` call
 * site to source its expiration from the single-source-of-truth `assocExpiry`
 * module. This test makes that drift impossible: every `src/` source file that
 * *calls* `buildAssociationTemplate(...)` MUST also import from `assocExpiry`,
 * so the only way to compute the `expirationSeconds` argument is through
 * `assocExpirationAt` / `ASSOC_TTL_SECONDS`.
 *
 * Excluded:
 *  - `src/lib/tepp/buildEvents.ts` — the vendored *definition* of the helper.
 *  - test files (`*.test.ts(x)`) — they assert against the constant directly.
 */

// `src/` root. vitest runs from the project root, so the repo's `src/` is a
// stable, resolver-independent anchor (avoids the dual-`nostr-tools` /
// non-file `import.meta.url` quirks the other tepp tests document).
const SRC_ROOT = join(process.cwd(), 'src');

/** The vendored definition of buildAssociationTemplate — not a caller. */
const DEFINITION_FILE = join(SRC_ROOT, 'lib', 'tepp', 'buildEvents.ts');

/** Matches an actual call `buildAssociationTemplate(` (not a `typeof` type ref). */
const CALL_RE = /\bbuildAssociationTemplate\s*\(/;
/** A `typeof buildAssociationTemplate` reference is a type, not a call site. */
const TYPEOF_RE = /\btypeof\s+buildAssociationTemplate\b/;
/** Any import from the assocExpiry single-source-of-truth module. */
const ASSOC_EXPIRY_IMPORT_RE = /from\s+['"](?:@\/lib\/tepp-adapters\/assocExpiry|\.\.?\/(?:.*\/)?assocExpiry)['"]/;

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listSourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(name)) continue;
    if (/\.test\.(ts|tsx)$/.test(name)) continue; // exclude test files
    out.push(full);
  }
  return out;
}

describe('assocExpiry drift guard (KUBO-166)', () => {
  it('every buildAssociationTemplate call site imports from assocExpiry', () => {
    const files = listSourceFiles(SRC_ROOT);
    const offenders: string[] = [];
    let callSitesChecked = 0;

    for (const file of files) {
      if (file === DEFINITION_FILE) continue; // the definition, not a caller
      const text = readFileSync(file, 'utf8');

      // Strip lines that are purely `typeof buildAssociationTemplate` type refs
      // (e.g. `ReturnType<typeof buildAssociationTemplate>`): a type usage does
      // not compute an expiration, so it has no TTL to source.
      const hasRealCall = text
        .split('\n')
        .some((line) => CALL_RE.test(line) && !TYPEOF_RE.test(line));

      if (!hasRealCall) continue;
      callSitesChecked += 1;

      if (!ASSOC_EXPIRY_IMPORT_RE.test(text)) {
        offenders.push(file.slice(SRC_ROOT.length + 1));
      }
    }

    // Sanity: the known call sites are actually being scanned (so a refactor
    // that renames/moves them doesn't silently make this test vacuous).
    expect(callSitesChecked).toBeGreaterThanOrEqual(3);

    expect(
      offenders,
      `These files call buildAssociationTemplate() but do not import from ` +
        `assocExpiry — source the expirationSeconds from assocExpirationAt() ` +
        `instead of a hardcoded TTL:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });
});
