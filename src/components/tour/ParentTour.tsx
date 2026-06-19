import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useKuboFamily } from '@/hooks/useKuboFamily';
import {
  setPinFlowActive,
  setTourStep,
  usePinFlowActive,
  useTourStep,
} from '@/lib/tourState';
import { Coachmark } from './Coachmark';

/**
 * First-run parent tour orchestrator (KUBO-092).
 *
 * Renders the right Coachmark for the current step + current route. Listens
 * for the route change from `/kid` → `/parent/home` to advance step 2 → 3
 * after the parent successfully sets a PIN.
 *
 * Mounted twice — once in KuboKidLayout (so steps 1, 2 fire), once in
 * KuboParentLayout (so steps 3, 4, 5 fire). Both instances share the same
 * tourState singleton + family.coachmarksCompletedAt flag, so they cooperate
 * cleanly without a top-of-tree mount that would conflict with Ditto's
 * upstream router.
 */
export function ParentTour() {
  const step = useTourStep();
  const pinFlowActive = usePinFlowActive();
  const { family, markCoachmarksComplete } = useKuboFamily();
  const { pathname } = useLocation();
  const nav = useNavigate();

  // Step 2 → 3: when ParentGateDialog routes from /kid to /parent/home, the
  // route change is our cue that PIN setup succeeded. Clear the pin-flow
  // flag and advance the tour. (The dialog's onOpenChange(false) also
  // clears the flag, but doing it here too is idempotent and guarantees
  // the parent-view popovers don't see a stale `true`.)
  //
  // Step 3 → 4: same gesture-driven pattern as step 2 — the parent must
  // physically tap the Feed nav item; we advance when they actually arrive
  // on /parent/feed. No Next button on step 3; the action IS the advance.
  useEffect(() => {
    if (step === 2 && pathname.startsWith('/parent/')) {
      setPinFlowActive(false);
      setTourStep(3);
      return;
    }
    if (step === 3 && pathname === '/parent/feed') {
      setTourStep(4);
    }
  }, [step, pathname]);

  // Hard guard: never render anything once the tour is complete or while
  // family is still loading.
  if (!family || family.coachmarksCompletedAt || step === 0) return null;

  // Use the most-recently-added kid for personalization. On first run that's
  // the only kid; for any later (manually-triggered) replays it's the most
  // recent one — fine.
  const kid = family.kids[family.kids.length - 1];
  const kidName = kid?.displayName ?? 'your kid';

  const skip = () => {
    setTourStep(0);
    setPinFlowActive(false);
    void markCoachmarksComplete();
  };

  const advance = (next: 1 | 2 | 3 | 4 | 5 | 6) => () => setTourStep(next);

  const finish = () => {
    setTourStep(0);
    setPinFlowActive(false);
    void markCoachmarksComplete();
  };

  // ─── Kid-view steps (only render on /kid/*) ────────────────────────────────
  if (pathname.startsWith('/kid')) {
    if (step === 1) {
      // Centered intro card — no anchor. The card is *about* the whole kid
      // view, so pointing it at any single element (e.g. the greeting) reads
      // as commentary on that element instead.
      return (
        <Coachmark
          anchorName={null}
          title={`This is ${kidName}'s view`}
          body={`This is what ${kidName} will see when opening Kubo. You'll set up the feed in a moment.`}
          nextLabel="Next"
          onNext={advance(2)}
          onSkip={skip}
        />
      );
    }
    if (step === 2) {
      // Hide the popover while the PIN dialog is open — otherwise the
      // non-modal popover sits on top of the dialog.
      if (pinFlowActive) return null;
      return (
        <Coachmark
          anchorName="parentGateGear"
          title="Tap the gear to switch to parent view"
          body={`You'll set a passcode first. It keeps ${kidName} out of parent settings — so it's safe to hand over the device.`}
          // No nextLabel → no Next button. The tour advances when the parent
          // physically taps the gear, which opens ParentGateDialog and (on
          // successful PIN setup) routes to /parent/home — caught by the
          // useEffect above.
          onSkip={skip}
          side="bottom"
          align="end"
        />
      );
    }
    // Steps 3-5 don't render on /kid/*
    return null;
  }

  // ─── Parent-view steps (only render on /parent/*) ──────────────────────────
  if (pathname.startsWith('/parent/')) {
    if (step === 3) {
      return (
        <Coachmark
          // Anchored to the Feed tab specifically, not the whole nav, so
          // the arrow points at the tab the parent needs to tap next.
          anchorName="parentFeedTab"
          title="Welcome to parent view"
          body={
            <div className="flex flex-col gap-2">
              <p>Two tabs do the real work:</p>
              <ul className="space-y-1">
                <li><strong>Feed</strong> — what shows up in {kidName}'s feed (you pick the sources)</li>
                <li><strong>Trust</strong> — who and where {kidName} can see and reply to beyond their follow list</li>
              </ul>
              <p className="text-slate-500">Tap <strong>Feed</strong> to keep going.</p>
            </div>
          }
          // No nextLabel → no Next button. Same gesture-driven pattern as
          // step 2: the parent must physically tap the Feed nav item, and
          // the route-change effect above advances the tour to step 4 when
          // they arrive on /parent/feed.
          onSkip={skip}
          side="top"
          align="center"
        />
      );
    }
    if (step === 4) {
      // Deferred until the parent has actually navigated to /parent/feed —
      // explaining the four source types while the source tiles are visible
      // makes the examples concrete instead of abstract. Step 3's Next
      // button auto-navigates here, but if the parent hand-navigates (e.g.
      // skipped Show-me-Feed and tapped the nav themselves) the same
      // pathname check still gates rendering.
      if (pathname !== '/parent/feed') return null;
      return (
        <Coachmark
          // Centered (not anchored): the feed source-tile stack is ~490px tall,
          // so a ~340px card can't fit above or below it on a phone — Radix
          // clamps it and the card runs off the bottom (the Galaxy S20 cutoff).
          // This step is a general "how feed sources work" primer rather than a
          // pointer at one tile, so a centered card reads correctly AND is
          // positioned by CSS that's guaranteed to fit the viewport.
          anchorName={null}
          title={`Pick where ${kidName}'s videos come from`}
          body={
            <div className="flex flex-col gap-2">
              <p>
                A starter <strong>Follow pack</strong> is already loaded, so
                {' '}{kidName}'s feed has something to start with.
              </p>
              <p>Want to swap it or add more sources?</p>
              <ul className="space-y-1">
                <li><strong>Follow packs</strong> — other curated lists</li>
                <li><strong>Profiles</strong> — add specific creators you know</li>
                <li><strong>Communities</strong> — groups like a parents' chat or soccer club</li>
                <li><strong>Relays</strong> — entire video sources, like a school relay</li>
              </ul>
            </div>
          }
          nextLabel="Next"
          onNext={advance(5)}
          onSkip={skip}
        />
      );
    }
    if (step === 5) {
      return (
        <Coachmark
          anchorName="kidSelectorPill"
          title="Switch between parent and kid view"
          body={`Tap up here to switch back to ${kidName}'s view, or to add another kid later.`}
          nextLabel="Next"
          onNext={() => {
            setTourStep(6);
            // Take the parent to the Support page so the Kubo Testers tile is
            // on screen for the final coachmark. Without this the step-6
            // popover never finds its anchor.
            nav('/parent/support');
          }}
          onSkip={skip}
          side="bottom"
          align="end"
        />
      );
    }
    if (step === 6) {
      // Wait until the parent is actually on the Support page — useNavigate
      // is async relative to the render. Without this gate, the popover
      // tries to anchor to `groupsSection` while the page is still
      // unmounted from the previous route, which fails silently.
      if (pathname !== '/parent/support') return null;
      return (
        <Coachmark
          anchorName="groupsSection"
          title="Chat with the Kubo team"
          body={
            <div className="flex flex-col gap-2">
              <p>
                Need a hand, or want to share feedback? This is your line to us.
              </p>
              <p>
                Tap the <strong>Kubo Testers</strong> tile any time to chat with
                the team and other early testers.
              </p>
            </div>
          }
          nextLabel="Done"
          onNext={finish}
          onSkip={skip}
          side="top"
          align="center"
        />
      );
    }
  }

  return null;
}
