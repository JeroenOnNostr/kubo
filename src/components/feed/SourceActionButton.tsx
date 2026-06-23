import { Plus, Minus, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * The single button used to add/remove a source from a kid's feed, shared
 * across every feed-source page (Profiles, Follow packs, Relays, Communities,
 * YouTube). Replaces the per-page Switch toggles so every "add a source"
 * surface looks and behaves identically (KUBO-208).
 *
 * The label is the verb, so the control reads as an action, not a state:
 *   - 'add'    → not in the feed yet      → primary "Add"
 *   - 'remove' → already in the feed      → secondary "Remove"
 *   - 'readd'  → saved but disabled       → secondary "Re-add"
 */
export type SourceAction = 'add' | 'remove' | 'readd';

const CONFIG: Record<
  SourceAction,
  { label: string; Icon: typeof Plus; variant: 'default' | 'secondary' }
> = {
  add: { label: 'Add', Icon: Plus, variant: 'default' },
  remove: { label: 'Remove', Icon: Minus, variant: 'secondary' },
  readd: { label: 'Re-add', Icon: RotateCcw, variant: 'secondary' },
};

export interface SourceActionButtonProps {
  action: SourceAction;
  onClick: () => void;
  disabled?: boolean;
  /** Used in the accessible label, e.g. `Add MrBeast`. */
  itemLabel?: string;
}

export function SourceActionButton({
  action,
  onClick,
  disabled,
  itemLabel,
}: SourceActionButtonProps) {
  const { label, Icon, variant } = CONFIG[action];
  return (
    <Button
      type="button"
      size="sm"
      variant={variant}
      className="h-8 rounded-full px-3 text-[12px] shrink-0"
      onClick={onClick}
      disabled={disabled}
      aria-label={itemLabel ? `${label} ${itemLabel}` : label}
    >
      <Icon className="size-3.5 mr-1" aria-hidden />
      {label}
    </Button>
  );
}
