import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * KUBO-200 — structural regression guard for the TEPP publish gate.
 *
 * Background: per KUBO-152 the authoritative enforcement flag is
 * `family.teppEnforced` (read via `isTeppEnforced`), NOT the device-local,
 * kid-clobberable `config.feedSettings.featureTepp` mirror. The mirror reads
 * `false` whenever a kid is the active session with synced settings omitting
 * `featureTepp` (KUBO-182's "adding a 2nd/3rd kid" scenario).
 *
 * Every hook that PUBLISHES a TEPP event (people grants, relay grants, the
 * reconcile pass, the kid request gift-wrap, the kid association) used to gate
 * that publish on the bare mirror. With enforcement on but the mirror false,
 * Approve / Assign-trust wrote localStorage + cleared the request but SKIPPED
 * the wire publish → the kid stayed denied on the wire. This is the exact bug
 * KUBO-182 already fixed for a UI element in TrustPeoplePage.
 *
 * This is a source-level mutation guard (modelled on the KUBO-160 wrap contract
 * in `gatedSigner.test.ts`): if a refactor re-introduces a bare-mirror gate in
 * any of these hooks, the corresponding publish silently bypasses enforcement
 * again. The pure predicate itself (`isTeppEnforced`) is unit-tested in
 * `src/lib/tepp-adapters/useTeppEnforced.test.ts`; this test pins that the
 * publish hooks actually KEY ON it.
 */

/** Hooks that gate a TEPP publish — must derive the gate from `isTeppEnforced`. */
const GATED_PUBLISH_HOOKS = [
  'useTrustAssignments.ts',
  'useRelayTrustAssignments.ts',
  'useEnsureParentTrust.ts',
  'useTrustRequests.ts',
  'useEnsureKidAssociation.ts',
];

/**
 * A bare-mirror gate assignment, e.g. `const x = !!config.feedSettings.featureTepp`.
 * The mention of `featureTepp` is fine inside comments/strings; what must NEVER
 * come back is ASSIGNING the gate from the mirror. We match the assignment shape
 * specifically so explanatory comments referencing the mirror don't trip it.
 */
const BARE_MIRROR_GATE = /=\s*!!\s*config\.feedSettings\.featureTepp/;

describe('TEPP publish gate keys on isTeppEnforced, not the featureTepp mirror (KUBO-200)', () => {
  for (const file of GATED_PUBLISH_HOOKS) {
    it(`${file} imports and gates on isTeppEnforced(family, kidPubkey)`, () => {
      const src = readFileSync(join(process.cwd(), 'src', 'hooks', file), 'utf8');
      // Imports the authoritative predicate from the seam module.
      expect(src).toMatch(
        /import\s*\{\s*isTeppEnforced\s*\}\s*from\s*['"]@\/lib\/tepp-adapters\/useTeppEnforced['"]/,
      );
      // Derives its gate from the predicate, keyed on (family, kidPubkey).
      expect(src).toMatch(/isTeppEnforced\s*\(\s*family\s*,\s*kidPubkey\s*\)/);
    });

    it(`${file} contains no bare featureTepp-mirror gate assignment`, () => {
      const src = readFileSync(join(process.cwd(), 'src', 'hooks', file), 'utf8');
      expect(BARE_MIRROR_GATE.test(src)).toBe(false);
    });
  }
});
