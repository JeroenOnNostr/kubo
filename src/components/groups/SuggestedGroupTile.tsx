import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useGroup } from '@/hooks/useGroup';
import { useGroupActions } from '@/hooks/useGroupActions';
import { cn } from '@/lib/utils';

interface SuggestedGroupTileProps {
  /** Full NIP-29 address `<host>'<gid>`. */
  addr: string;
  title: string;
  subtitle: string;
  /** Optional initial / picture for the avatar fallback. */
  avatarLabel?: string;
  /**
   * When true the user is already a member: hide the "Suggested" pill (the
   * tile now reads as a plain "open the chat" CTA). Tapping still navigates
   * into the group — the join mutation treats "already a member" as success.
   * Used on the Support page, where the tile always renders regardless of
   * membership.
   */
  joined?: boolean;
}

/**
 * "Suggested" tile shown above the joined-groups list when the user
 * isn't a member of a recommended group (e.g. Kubo Testers). Visually
 * mirrors TrustRow density (size-8 avatar, name + subtitle, trailing
 * chevron) so it sits in the same visual rhythm; the only difference
 * is a small "Suggested" pill and a soft primary tint to read as a
 * CTA.
 *
 * Tapping joins via kind 9021, appends to kind 10009, and navigates
 * into the group. If the relay reports `duplicate: already a member`
 * — meaning the user joined elsewhere — we treat it as success, sync
 * the list, and navigate in (handled by the shared join mutation).
 */
export function SuggestedGroupTile({
  addr,
  title,
  subtitle,
  avatarLabel,
  joined = false,
}: SuggestedGroupTileProps) {
  const nav = useNavigate();
  const { join, pending } = useGroupActions();
  const { data: group } = useGroup(addr);
  const [error, setError] = useState<string | null>(null);

  // Prefer the group's own NIP-29 (kind-39000) name/about so the tile shows
  // what the group actually calls itself; fall back to the passed props while
  // the metadata loads (avoids an empty flash) or if the relay omits them.
  const displayTitle = group?.name?.trim() || title;
  const displaySubtitle = group?.about?.trim() || subtitle;

  const initial = (avatarLabel ?? displayTitle).slice(0, 1).toUpperCase();
  const picture = group?.picture;

  const onClick = async () => {
    if (pending.join) return;
    setError(null);
    try {
      await join(addr);
      nav(`/parent/groups/${encodeURIComponent(addr)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join. Try again.');
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending.join}
        className={cn(
          'w-full flex items-center gap-3 p-3 rounded-xl text-left',
          // Uniform card background, matching the NavTiles beside it and the
          // tappable tiles across the app (Feed/Trust). The "Suggested" pill —
          // not a tinted background — is what signals this is a CTA.
          'bg-card hover:bg-card/80 transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          'disabled:opacity-60',
        )}
      >
        {picture ? (
          <img
            src={picture}
            alt=""
            className="size-8 rounded-full object-cover flex-shrink-0"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div
            className="size-8 rounded-full flex items-center justify-center text-[11px] font-semibold text-primary-foreground bg-primary flex-shrink-0"
            aria-hidden
          >
            {initial}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate flex items-center gap-1.5">
            <span className="truncate">{displayTitle}</span>
            {!joined && (
              <span className="text-[9px] uppercase tracking-[0.08em] text-primary font-semibold flex-shrink-0">
                Suggested
              </span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground truncate">{displaySubtitle}</div>
        </div>
        <ChevronRight className="size-4 text-muted-foreground flex-shrink-0" aria-hidden />
      </button>
      {error && (
        <div className="text-[11px] text-destructive px-2.5">{error}</div>
      )}
    </div>
  );
}
