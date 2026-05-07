import { useSyncExternalStore } from 'react';

/**
 * Module-level singleton for the first-run parent coachmark tour (KUBO-092).
 *
 * Lives outside React because the tour spans a signer swap (kid → parent via
 * ParentGateDialog) that tears down KuboKidLayout, so any context inside that
 * layout would unmount mid-flow. The singleton survives that. Persistence of
 * "tour finished, never show again" lives in the family record
 * (`coachmarksCompletedAt`); this module only holds the *current step* during
 * the in-progress flow.
 *
 * Steps:
 *   0 = inactive (not started, or finished)
 *   1 = centered intro card on /kid (no anchor — full-screen statement)
 *   2 = parent-gate gear icon (no Next button — advances on gate-success)
 *   3 = parent bottom nav (Home/Feed/Trust/Upload/Alerts overview)
 *   4 = parent Feed source-tiles area on /parent/feed (source-types primer)
 *   5 = kid selector pill (round-trip + add another kid)
 *
 * pinFlowActive: true while ParentGateDialog is open. Used by step 2 to
 * unmount the gear popover when the dialog appears (otherwise the popover
 * sits on top of the dialog). Two dialogs (the gear-button's local one in
 * KuboKidTopBar and the layout-level one in KuboKidLayout for the back-
 * gesture guard) both write to this flag — single source of truth.
 */
export type TourStep = 0 | 1 | 2 | 3 | 4 | 5;

let currentStep: TourStep = 0;
let pinFlowActive = false;
const subscribers = new Set<() => void>();

function notify(): void {
  subscribers.forEach((cb) => cb());
}

export function setTourStep(step: TourStep): void {
  if (currentStep === step) return;
  currentStep = step;
  notify();
}

export function getTourStep(): TourStep {
  return currentStep;
}

export function setPinFlowActive(active: boolean): void {
  if (pinFlowActive === active) return;
  pinFlowActive = active;
  notify();
}

export function getPinFlowActive(): boolean {
  return pinFlowActive;
}

/**
 * Reset the in-memory tour position. Does NOT touch the family record's
 * `coachmarksCompletedAt` flag — that persists "never show again". Use this
 * for tests / dev tooling to re-enter the tour after manually clearing the
 * family flag.
 */
export function resetTourState(): void {
  setTourStep(0);
  setPinFlowActive(false);
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

export function useTourStep(): TourStep {
  return useSyncExternalStore(subscribe, getTourStep, getTourStep);
}

export function usePinFlowActive(): boolean {
  return useSyncExternalStore(subscribe, getPinFlowActive, getPinFlowActive);
}
