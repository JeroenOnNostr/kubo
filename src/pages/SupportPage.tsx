import { ChevronRight, MessageCircle } from 'lucide-react';
import { useRef } from 'react';

import { NavTile } from '@/components/NavTile';
import { WotfLogo, WotfWordmark } from '@/components/WotfBrandmark';
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
 *  - Get support  — report bugs / give feedback via the Kubo Testers group
 *    chat + our Signal group. The copy frames reports as essential to
 *    improving Kubo (KUBO-210).
 *  - Give support — fund Kubo via the foundation's website (in-app payment
 *    processing is still deferred — KUBO-186). The "Support Kubo" tile is
 *    branded for the Web of Trust Foundation: its WoTF logo + the
 *    "Web of Trust Foundation" wordmark in Merriweather (the foundation's
 *    brand serif) match the foundation's site (KUBO-210).
 *
 * The Kubo Testers tile is the single home for joining that group (it was
 * moved off Trust → People). The onboarding tour's final step anchors to it
 * here via the `groupsSection` tour anchor; layman wording per KUBO-105.
 */
export function SupportPage() {
  const { data: groups, isPending } = useGroups();
  const joinedTesters = (groups ?? []).some((g) => g.addr === KUBO_TESTERS_GROUP);
  // Until the kind-10009 list resolves we don't yet know whether the parent is
  // a member, so leave membership "unknown" rather than defaulting to "not
  // joined" — otherwise the "Suggested" pill flashes on every cold start for a
  // parent who already joined (KUBO-208). `isPending` is true only while the
  // first fetch is in flight (no cache yet, e.g. app reboot); once a cached
  // result exists it stays resolved across remounts.
  const membershipKnown = !isPending;

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
          Hit a bug or have feedback? Please tell us. Your reports are essential
          to improving Kubo. Reach the team and other testers in the group chats
          below.
        </p>
        <div ref={testersRef}>
          <SuggestedGroupTile
            addr={KUBO_TESTERS_GROUP}
            title="Kubo Testers"
            subtitle="Report bugs & share feedback with the Kubo team"
            joined={joinedTesters}
            membershipKnown={membershipKnown}
          />
        </div>
        <NavTile
          icon={<MessageCircle className="size-5" />}
          title="Join our Signal group"
          subtitle="Chat with us & report issues — opens Signal"
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
        {/* WoTF-branded "Support Kubo" tile: the foundation's logo as the tile
            icon + the "Web of Trust Foundation" wordmark (Merriweather), so the
            brand lives inside the clickable target rather than floating above
            the copy. Mirrors NavTile's structure/affordances. */}
        <button
          type="button"
          onClick={() => void openExternalLink(DONATE_URL)}
          aria-label="Support Kubo via the Web of Trust Foundation — opens our website"
          className="w-full flex items-center gap-3 p-3 rounded-xl bg-card hover:bg-card/80 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <WotfLogo className="size-6" />
          </div>
          <div className="flex-1 min-w-0">
            <WotfWordmark className="block text-sm text-foreground" />
            <div className="text-[11px] text-muted-foreground truncate">
              Support Kubo — opens our website
            </div>
          </div>
          <ChevronRight className="size-4 text-muted-foreground flex-shrink-0" aria-hidden />
        </button>
      </section>
    </div>
  );
}
