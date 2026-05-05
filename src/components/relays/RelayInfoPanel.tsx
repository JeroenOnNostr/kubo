import { Link } from 'react-router-dom';
import { ExternalLink, Mail, Shield, Zap } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { type RelayInfoDocument } from '@/hooks/useRelayInfo';

/**
 * Reusable bits of relay metadata UI shared between the feed-source Relays
 * page (toggle-style rows) and the Trust Places page (trust-level rows).
 * Keep this module behaviour-only — no per-page styling differences — so
 * the two pages render identical NIP-11 info panels.
 */

export function RelayBadges({ info }: { info: RelayInfoDocument | undefined }) {
  const paymentRequired = Boolean(
    info?.limitation?.payment_required ?? info?.payment_required,
  );
  const authRequired = Boolean(
    info?.limitation?.auth_required ?? info?.auth_required,
  );
  const notableNips = (info?.supported_nips ?? []).filter(
    (nip) => nip === 42 || nip === 50,
  );
  if (!paymentRequired && !authRequired && notableNips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {notableNips.includes(50) && (
        <Badge variant="outline" className="text-[10px]">NIP-50</Badge>
      )}
      {notableNips.includes(42) && (
        <Badge variant="outline" className="text-[10px]">NIP-42</Badge>
      )}
      {authRequired && (
        <Badge variant="secondary" className="gap-1 text-[10px]">
          <Shield className="size-2.5" />
          Auth
        </Badge>
      )}
      {paymentRequired && (
        <Badge variant="secondary" className="gap-1 text-[10px]">
          <Zap className="size-2.5" />
          Paid
        </Badge>
      )}
    </div>
  );
}

export function RelayFooter({
  url,
  info,
}: {
  url: string;
  info: RelayInfoDocument | undefined;
}) {
  const contact = info?.contact?.trim();
  const encoded = encodeURIComponent(url);
  return (
    <div className="flex flex-wrap gap-3 text-[12px]">
      {contact && (
        <a
          href={contact.includes('@') ? `mailto:${contact}` : contact}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          <Mail className="size-3" />
          {contact}
        </a>
      )}
      <Link
        to={`/r/${encoded}`}
        className="inline-flex items-center gap-1 text-primary hover:underline"
      >
        <ExternalLink className="size-3" />
        Visit relay
      </Link>
    </div>
  );
}

/**
 * Full NIP-11 info block: description + badges + footer. Used in the body
 * of an expanded relay row. Mirrors the visual layout that
 * ExpandableSourceRow uses for its accordion content (description text +
 * footer below).
 */
export function RelayInfoPanel({
  url,
  info,
}: {
  url: string;
  info: RelayInfoDocument | undefined;
}) {
  const description = info?.description?.trim();
  const badges = <RelayBadges info={info} />;

  return (
    <div className="flex flex-col gap-2">
      {badges}
      <div className="text-[12px] text-muted-foreground leading-relaxed">
        {description || (
          <span className="italic">No description provided.</span>
        )}
      </div>
      <RelayFooter url={url} info={info} />
    </div>
  );
}
