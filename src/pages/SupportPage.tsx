import { HeartHandshake, MessageCircle } from 'lucide-react';
import { useRef } from 'react';

import { NavTile } from '@/components/NavTile';
import { SuggestedGroupTile } from '@/components/groups/SuggestedGroupTile';
import { useGroups } from '@/hooks/useGroups';
import { useRegisterTourAnchor } from '@/contexts/TourAnchorContext';
import { KUBO_TESTERS_GROUP } from '@/lib/appRelays';
import { openExternalLink } from '@/lib/downloadFile';

/**
 * Signal group invite (deep-links into the Signal app, else the browser /
 * Play Store via the OS link handler). Single hardcoded community link.
 */
const SIGNAL_GROUP_URL =
  'https://signal.group/#CjQKIPO-NzpZJHdFTKUD76Uc2aptmPn8b4G1P_7IVK8ezXDcEhBU4FtP4T4Rh8sXd_-1rmAo';

/** Web of Trust Foundation support / contribute page. */
const DONATE_URL = 'https://weboftrustfoundation.com/contribute';

/**
 * /parent/support — the bottom-nav tab that replaced Alerts (KUBO-185 vacated
 * the slot; KUBO-186 fills it).
 *
 * Two sections:
 *  - Get support  — join the Kubo Testers group chat + our Signal group.
 *  - Give support — fund Kubo via the foundation's website (in-app payment
 *    processing is still deferred — KUBO-186).
 *
 * The Kubo Testers tile is the single home for joining that group (it was
 * moved off Trust → People). The onboarding tour's final step anchors to it
 * here via the `groupsSection` tour anchor; layman wording per KUBO-105.
 */
export function SupportPage() {
  const { data: groups } = useGroups();
  const joinedTesters = (groups ?? []).some((g) => g.addr === KUBO_TESTERS_GROUP);

  // Tour anchor (step 6): the coachmark points the parent at the Kubo Testers
  // tile so they know where to reach us. Moved here from GroupsSection.
  const testersRef = useRef<HTMLDivElement>(null);
  useRegisterTourAnchor('groupsSection', testersRef);

  return (
    <div className="flex flex-col gap-6 px-4 pt-2 pb-6">
      {/* No page-level header — uniform with the other parent screens (Feed,
          Trust, Upload), which start directly with their content under the
          global kubo wordmark + profile chip. */}

      {/* ── Get support ─────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Get support</h2>
        <p className="text-[12px] text-muted-foreground px-1">
          Have a question or run into trouble? Reach the Kubo community for help.
        </p>
        <div ref={testersRef}>
          <SuggestedGroupTile
            addr={KUBO_TESTERS_GROUP}
            title="Kubo Testers"
            subtitle="Chat with the Kubo team and other early testers"
            joined={joinedTesters}
          />
        </div>
        <NavTile
          icon={<MessageCircle className="size-5" />}
          title="Join our Signal group"
          subtitle="Opens Signal"
          onClick={() => void openExternalLink(SIGNAL_GROUP_URL)}
        />
      </section>

      {/* ── Give support ────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Give support</h2>
        <p className="text-[12px] text-muted-foreground px-1">
          Kubo is built by the Web of Trust Foundation, a registered Dutch
          nonprofit. Every contribution goes straight back into building and
          running the app.
        </p>
        <NavTile
          icon={<HeartHandshake className="size-5" />}
          title="Support Kubo"
          subtitle="Opens our website"
          onClick={() => void openExternalLink(DONATE_URL)}
        />
      </section>
    </div>
  );
}
