/**
 * Transient handoff between the parent-onboarding step (either fresh-signup
 * `CreateParentAccountPage` or existing-account `ParentLoginPage`) and the
 * `AddKidPage` step that actually anchors `kubo:family`.
 *
 * Lives in `localStorage` (not `secureStorage`) because it's plain
 * non-secret display data that needs to survive a hard reload between
 * onboarding screens. Cleared once the first kid is written.
 */

const STORAGE_KEY = 'kubo:onboarding-parent';

export interface OnboardingParent {
  parentPubkey: string;
  parentDisplayName: string;
}

export function setOnboardingParent(value: OnboardingParent): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // localStorage might be unavailable (private mode, full quota); the
    // worst case is the user re-types their name on reload.
  }
}

export function getOnboardingParent(): OnboardingParent | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof parsed.parentPubkey === 'string' &&
      typeof parsed.parentDisplayName === 'string'
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearOnboardingParent(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort cleanup; nothing to do if it fails.
  }
}
