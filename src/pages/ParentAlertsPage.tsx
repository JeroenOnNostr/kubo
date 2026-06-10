import { useMemo, type ReactNode } from 'react';
import { Bell, Eye, Play, UserPlus, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useAuthor } from '@/hooks/useAuthor';
import { useKuboFamily } from '@/hooks/useKuboFamily';
import { useSelectedKid } from '@/hooks/useSelectedKid';
import { useToast } from '@/hooks/useToast';
import { useTrustAssignments } from '@/hooks/useTrustAssignments';
import { genUserName } from '@/lib/genUserName';

/**
 * Discriminated union of every request shape that can land in the Alerts
 * inbox. Today only `interact` is wired (kid → parent trust upgrade); the
 * `follow` / `watch` / `join` variants are scaffolded so adding their
 * persistence + kid-side UI later is purely additive — the tile renderer
 * already knows how to dispatch on `kind`.
 *
 * Shared keys: `kidPubkey`, `kidDisplayName`, `createdAt`. The rest depends on
 * the request kind.
 */
interface BaseAlertItem {
  kidPubkey: string;
  kidDisplayName: string;
  createdAt: number;
  /** Stable key for React lists. */
  key: string;
}

interface InteractAlertItem extends BaseAlertItem {
  kind: 'interact';
  targetPubkey: string;
}

interface FollowAlertItem extends BaseAlertItem {
  kind: 'follow';
  targetPubkey: string;
}

interface WatchAlertItem extends BaseAlertItem {
  kind: 'watch';
  /** Hex event id of the kind 21/22 video the kid asked to play. */
  eventId: string;
  /** Best-effort title / display name of the video subject. */
  subject: string;
}

interface JoinAlertItem extends BaseAlertItem {
  kind: 'join';
  /** Group display name. */
  groupName: string;
}

type AlertItem =
  | InteractAlertItem
  | FollowAlertItem
  | WatchAlertItem
  | JoinAlertItem;

/**
 * Each request kind has a bolded action ("interact", "follow", "watch",
 * "join") immediately followed by an optional plain-text connector that
 * leads into the subject. Connectors keep the sentence reading naturally
 * across kinds:
 *   "Kid2 requested to interact with TravelTelly."
 *   "Charlie requested to watch Giraffes in Africa."
 *   "Charlie requested to join Girlscouts group."
 */
const VERB: Record<AlertItem['kind'], { action: string; connector: string }> = {
  interact: { action: 'interact', connector: ' with ' },
  follow:   { action: 'follow',   connector: ' '       },
  watch:    { action: 'watch',    connector: ' '       },
  join:     { action: 'join',     connector: ' '       },
};

const ICON: Record<AlertItem['kind'], typeof Eye> = {
  interact: Eye,
  follow: UserPlus,
  watch: Play,
  join: Users,
};

/**
 * /parent/alerts — inbox for kid → parent requests + future safety
 * notifications.
 *
 * Today the only alert kind is a "Request to interact" emitted by
 * RequestInteractButton on the kid's profile-view of a creator. Parent taps
 * Approve → atomic write that clears the request and assigns
 * trustAssignments[kid][creator] = 'interact' (so the creator shows up under
 * Trust → People → Interact). Deny → just clears the request.
 *
 * Scoped to `useSelectedKid()` to match the rest of the parent app. When no
 * kid is selected, all pending requests are shown, labeled with the kid's
 * display name on each row.
 */
export function ParentAlertsPage() {
  const { family } = useKuboFamily();
  const selectedKid = useSelectedKid();

  const alerts = useMemo<AlertItem[]>(() => {
    if (!family?.trustRequests) return [];
    const kidsByPubkey = new Map(family.kids.map((k) => [k.pubkey, k]));
    const out: AlertItem[] = [];
    for (const [kidPubkey, byTarget] of Object.entries(family.trustRequests)) {
      if (selectedKid && kidPubkey !== selectedKid.pubkey) continue;
      const kid = kidsByPubkey.get(kidPubkey);
      const kidDisplayName = kid?.displayName ?? genUserName(kidPubkey);
      for (const [targetPubkey, req] of Object.entries(byTarget)) {
        out.push({
          kind: 'interact',
          kidPubkey,
          kidDisplayName,
          targetPubkey,
          createdAt: req.createdAt,
          key: `interact:${kidPubkey}:${targetPubkey}`,
        });
      }
    }
    // Future request types (follow / watch / join) feed into `out` here, then
    // a single sort-and-render path takes over.
    out.sort((a, b) => b.createdAt - a.createdAt);
    return out;
  }, [family, selectedKid]);

  return (
    <div className="flex flex-col gap-3 px-4 pt-2 pb-6">
      {alerts.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <Bell className="size-8 text-muted-foreground/60" aria-hidden />
          <div className="text-sm font-semibold">No alerts</div>
          <p className="text-[12px] text-muted-foreground max-w-[240px]">
            Requests from your kid and safety notifications will show up here.
          </p>
        </div>
      ) : (
        alerts.map((alert) => <AlertTile key={alert.key} alert={alert} />)
      )}
    </div>
  );
}

// ─── Tile dispatcher ─────────────────────────────────────────────────────────

function AlertTile({ alert }: { alert: AlertItem }) {
  switch (alert.kind) {
    case 'interact':
      return <InteractTile alert={alert} />;
    case 'follow':
      return <FollowTile alert={alert} />;
    case 'watch':
      return <WatchTile alert={alert} />;
    case 'join':
      return <JoinTile alert={alert} />;
  }
}

// ─── Shared shell ────────────────────────────────────────────────────────────

interface RequestShellProps {
  kind: AlertItem['kind'];
  /** Bolded inside the sentence. */
  kidDisplayName: string;
  /** Bolded inside the sentence after the verb. */
  subject: string;
  /** Optional small thumbnail (e.g. creator avatar) at the trailing edge. */
  thumbnail?: ReactNode;
  onApprove: () => void;
  onDeny: () => void;
}

/**
 * Standardized request-tile shell. Sentence pattern:
 *
 *   "<Kid> requested to <verb> <subject>."
 *
 * Layout matches NavTile's bento language: bg-card rounded-xl p-3, a tinted
 * primary square holding a per-type icon, then a two-line stack with a tiny
 * uppercase eyebrow ("INTERACT" / "FOLLOW" / …) and the sentence under it.
 * Approve / Deny pills span the bottom row at full width.
 */
function RequestShell({
  kind,
  kidDisplayName,
  subject,
  thumbnail,
  onApprove,
  onDeny,
}: RequestShellProps) {
  const Icon = ICON[kind];
  const { action, connector } = VERB[kind];

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-card p-3">
      <div className="flex items-start gap-3">
        <div
          className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0"
          aria-hidden
        >
          <Icon className="size-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">
            {kind}
          </div>
          <div className="text-[13px] text-foreground/90 leading-snug">
            <span className="font-semibold">{kidDisplayName}</span>
            {' '}requested to{' '}
            <span className="font-semibold">{action}</span>
            {connector}
            <span className="font-semibold">{subject}</span>.
          </div>
        </div>
        {thumbnail}
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="default"
          onClick={onApprove}
          className="flex-1"
        >
          Approve
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onDeny}
          className="flex-1"
        >
          Deny
        </Button>
      </div>
    </div>
  );
}

// ─── Interact (live) ─────────────────────────────────────────────────────────

function InteractTile({ alert }: { alert: InteractAlertItem }) {
  const { clearTrustRequest } = useKuboFamily();
  const { toast } = useToast();
  const { data: author } = useAuthor(alert.targetPubkey);
  // KUBO-167: approval must publish the TEPP grant (8710 + state) — not just a
  // localStorage write — so the construct actually admits the creator. The
  // store-only `approveTrustRequest` left the kid "approved" but permanently
  // denied on the wire (and the no-downgrade invariant then blocked any
  // re-grant). `approveRequest` grants `interact`, publishes when TEPP is
  // enforced, and clears the request ONLY on publish success.
  const trust = useTrustAssignments(alert.kidPubkey);

  const metadata = author?.metadata;
  const subject =
    metadata?.display_name || metadata?.name || genUserName(alert.targetPubkey);

  const handleApprove = async () => {
    try {
      await trust.approveRequest(alert.targetPubkey);
      toast({ title: 'Trust set to Interact' });
    } catch (err) {
      // Publish failed → the request was NOT cleared (so the parent can retry).
      toast({
        title: 'Could not approve request',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    }
  };

  const handleDeny = async () => {
    try {
      await clearTrustRequest(alert.kidPubkey, alert.targetPubkey);
      toast({ title: 'Request denied' });
    } catch (err) {
      toast({
        title: 'Could not deny request',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    }
  };

  return (
    <RequestShell
      kind="interact"
      kidDisplayName={alert.kidDisplayName}
      subject={subject}
      thumbnail={
        metadata?.picture && (
          <img
            src={metadata.picture}
            alt=""
            className="size-10 rounded-full object-cover flex-shrink-0"
          />
        )
      }
      onApprove={handleApprove}
      onDeny={handleDeny}
    />
  );
}

// ─── Scaffolds for future request kinds ──────────────────────────────────────
// These render via the same shell so the parent UI is ready when their
// persistence + kid-side UI lands. They don't appear today (the alerts memo
// only emits `interact` items).

function FollowTile({ alert }: { alert: FollowAlertItem }) {
  const { data: author } = useAuthor(alert.targetPubkey);
  const subject =
    author?.metadata?.display_name ||
    author?.metadata?.name ||
    genUserName(alert.targetPubkey);
  return (
    <RequestShell
      kind="follow"
      kidDisplayName={alert.kidDisplayName}
      subject={subject}
      onApprove={() => undefined}
      onDeny={() => undefined}
    />
  );
}

function WatchTile({ alert }: { alert: WatchAlertItem }) {
  return (
    <RequestShell
      kind="watch"
      kidDisplayName={alert.kidDisplayName}
      subject={alert.subject}
      onApprove={() => undefined}
      onDeny={() => undefined}
    />
  );
}

function JoinTile({ alert }: { alert: JoinAlertItem }) {
  return (
    <RequestShell
      kind="join"
      kidDisplayName={alert.kidDisplayName}
      subject={alert.groupName}
      onApprove={() => undefined}
      onDeny={() => undefined}
    />
  );
}
