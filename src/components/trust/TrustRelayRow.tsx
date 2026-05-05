import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Server } from 'lucide-react';

import { useToast } from '@/hooks/useToast';
import { TrustAssignmentBarVisual } from '@/components/trust/TrustAssignmentBar';
import { TrustRow } from '@/components/trust/TrustRow';
import { RelayInfoPanel } from '@/components/relays/RelayInfoPanel';
import type { DiscoveredRelay } from '@/hooks/useRelayDiscovery';
import { type KuboTrustLevel } from '@/hooks/useKuboFamily';
import { useRelayInfo } from '@/hooks/useRelayInfo';
import { useRelayTrustAssignments } from '@/hooks/useRelayTrustAssignments';
import { relayHostOf } from '@/lib/relayUrl';

interface TrustRelayRowProps {
  /** The relay being rendered. `info` may be empty for assigned rows whose
   * NIP-66 record has aged out of the discovery cache — display falls back
   * to the host name and the row lazy-fetches NIP-11 on first expand. */
  relay: DiscoveredRelay;
  /** The kid whose relay-assignment map owns this row. */
  kidPubkey: string;
  /** Current trust assignment, or undefined if unassigned. */
  assigned: KuboTrustLevel | undefined;
}

/**
 * One row of a kid's trusted-relays list. Mirrors TrustFollowRow + the
 * feed-relays row: collapsed view shows avatar + name + trust-level dot;
 * expanded view shows the relay's NIP-11 info panel (description, badges,
 * Visit-relay link, contact) above the trust-level picker.
 *
 * NIP-11 source: prefer inline `relay.info` from the NIP-66 discovery
 * monitor; fall back to a lazy useRelayInfo HTTP fetch for assigned rows
 * whose discovery record has aged out (only fires after first expand —
 * KUBO-054 perf fix).
 */
export const TrustRelayRow = memo(function TrustRelayRow({
  relay,
  kidPubkey,
  assigned,
}: TrustRelayRowProps) {
  const { setLevel, clear } = useRelayTrustAssignments(kidPubkey);
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  const [activated, setActivated] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  // The discovery monitor includes name+description+icon inline in `relay.info`,
  // but assigned rows for relays no longer in the discovery cache have an
  // empty info object. Lazy-fetch NIP-11 only after first expand.
  const hasInlineInfo = !!(relay.info.name || relay.info.description || relay.info.icon);
  const { data: fetchedInfo } = useRelayInfo(
    !hasInlineInfo && activated ? relay.url : undefined,
  );
  const info = hasInlineInfo ? relay.info : (fetchedInfo ?? relay.info);

  useEffect(() => {
    if (expanded) {
      setActivated(true);
      barRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [expanded]);

  const handleSet = useCallback(
    async (level: KuboTrustLevel) => {
      if (pending) return;
      setPending(true);
      try {
        await setLevel(relay.url, level);
        setExpanded(false);
      } catch (err) {
        toast({
          title: 'Could not save trust level',
          description: err instanceof Error ? err.message : String(err),
          variant: 'destructive',
        });
      } finally {
        setPending(false);
      }
    },
    [pending, setLevel, relay.url, toast],
  );

  const handleClear = useCallback(async () => {
    if (pending) return;
    setPending(true);
    try {
      await clear(relay.url);
      setExpanded(false);
    } catch (err) {
      toast({
        title: 'Could not clear trust level',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setPending(false);
    }
  }, [pending, clear, relay.url, toast]);

  const name = info.name?.trim() || relayHostOf(relay.url);
  const icon = info.icon;

  const avatar = icon ? (
    <img src={icon} alt="" className="size-8 rounded-full object-cover" />
  ) : (
    <Server className="size-4 text-muted-foreground" aria-hidden />
  );

  return (
    <div className="flex flex-col">
      <TrustRow
        avatar={avatar}
        avatarBg={icon ? undefined : '#475569'}
        name={name}
        subtitle={relayHostOf(relay.url)}
        level={assigned}
        expanded={expanded}
        onClick={() => setExpanded((e) => !e)}
      />
      {expanded && (
        <div ref={barRef} className="px-2.5 pb-2.5 pt-2 rounded-b-xl bg-card/60 flex flex-col gap-3">
          <RelayInfoPanel url={relay.url} info={info} />
          <TrustAssignmentBarVisual
            currentLevel={assigned}
            onSetLevel={handleSet}
            onClear={handleClear}
            pending={pending}
          />
        </div>
      )}
    </div>
  );
});
