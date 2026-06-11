import { describe, expect, it } from 'vitest';

import { resolveKidActiveFeatureTeppMirror } from './featureTeppMirror';

/**
 * KUBO-182 — adding a 2nd/3rd kid flipped the active session to the new kid,
 * whose seeded synced settings omit `featureTepp`. The kid-active merge in
 * NostrSync must preserve the parent's mirror; when the parent never set it on
 * this device the fallback must be the app-wide default (ON), not `false` —
 * otherwise the Trust → Diagnostics link silently disappears while TEPP is
 * still enforced for the family.
 */
describe('resolveKidActiveFeatureTeppMirror', () => {
  it('an explicitly-persisted ON mirror is preserved', () => {
    expect(resolveKidActiveFeatureTeppMirror(true, true)).toBe(true);
    expect(resolveKidActiveFeatureTeppMirror(true, false)).toBe(true);
  });

  it('an explicitly-persisted OFF mirror is preserved (parent turned it off)', () => {
    // A deliberate parent opt-out must survive a kid switch — false wins over
    // the app default.
    expect(resolveKidActiveFeatureTeppMirror(false, true)).toBe(false);
    expect(resolveKidActiveFeatureTeppMirror(false, false)).toBe(false);
  });

  it('an unset mirror falls back to the app-wide default ON (the KUBO-182 fix)', () => {
    // This is the regression: device where the parent never touched the toggle.
    // Persisted mirror is undefined; the default-ON app value must win so the
    // Diagnostics link stays visible after adding a 2nd/3rd kid.
    expect(resolveKidActiveFeatureTeppMirror(undefined, true)).toBe(true);
  });

  it('an unset mirror honours an app default of OFF', () => {
    // If a build genuinely defaulted TEPP off, an unset mirror tracks that —
    // the helper never invents ON, it just stops inventing OFF.
    expect(resolveKidActiveFeatureTeppMirror(undefined, false)).toBe(false);
  });
});
