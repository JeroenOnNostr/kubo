import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/**
 * Kid → Parent "request to watch" modal. Visual only.
 *
 * Shown when a kid taps a video outside their trust domain. Sending a
 * request will, in a later PR, publish a custom ephemeral kind 1xxx
 * referencing the video + parent pubkey. Here the primary CTA just
 * closes the dialog.
 */
export function KidRequestSheet({
  open,
  onOpenChange,
  title = 'Baking bread with grandma',
  creator = 'CozyKitchen',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  creator?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'max-w-[340px] rounded-3xl border-0 p-6',
          'bg-white/10 backdrop-blur-xl text-white',
        )}
        style={{ background: 'rgba(255,255,255,0.1)' }}
      >
        <DialogHeader>
          <DialogTitle className="text-center text-[15px] font-bold">
            Ask a parent?
          </DialogTitle>
        </DialogHeader>

        {/* Thumbnail */}
        <div
          className="aspect-video rounded-xl"
          style={{ background: 'linear-gradient(135deg,#475569,#1E293B)' }}
          aria-hidden
        />

        <div className="text-center">
          <div className="text-[13px] font-semibold">{title}</div>
          <div className="text-[10px] text-white/60 mt-0.5">{creator}</div>
        </div>

        <p className="text-[11px] text-white/70 text-center leading-relaxed">
          This creator isn't on your trusted list yet.<br />
          Ask a grown-up to add them.
        </p>

        <div className="flex flex-col gap-2 mt-1">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-12 rounded-full bg-white text-[#0F172A] font-semibold active:scale-[0.98] transition-transform"
          >
            Send request
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-12 rounded-full border border-white/20 text-white font-semibold active:scale-[0.98] transition-transform"
          >
            Not now
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
