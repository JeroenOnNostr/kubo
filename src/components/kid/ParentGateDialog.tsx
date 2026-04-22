import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useParentGatePin } from '@/hooks/useParentGatePin';

/**
 * Passcode dialog for switching out of the kid app into the parent app.
 *
 * On first use the dialog becomes a 2-step setup (pick a PIN, confirm it).
 * Thereafter it verifies against the stored hash. Wrong code shakes and
 * clears. Cancel closes.
 */

type Phase =
  | 'loading'          // still reading isSet from storage
  | 'setup-choose'     // no PIN yet, parent picks one
  | 'setup-confirm'    // parent re-enters to confirm
  | 'verify';          // PIN exists, parent verifies to pass gate

export function ParentGateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const nav = useNavigate();
  const { isSet, setPin, verifyPin } = useParentGatePin();

  const [phase, setPhase] = useState<Phase>('loading');
  const [code, setCode] = useState('');
  const [chosenPin, setChosenPin] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Pick the right phase whenever the dialog opens (or isSet changes).
  useEffect(() => {
    if (!open) return;
    if (isSet === null) {
      setPhase('loading');
      return;
    }
    setPhase(isSet ? 'verify' : 'setup-choose');
    setCode('');
    setChosenPin(null);
    setErr(null);
  }, [open, isSet]);

  const reset = () => {
    setCode('');
    setChosenPin(null);
    setErr(null);
  };

  const close = () => {
    onOpenChange(false);
    reset();
  };

  const onComplete6 = async (six: string) => {
    if (phase === 'verify') {
      setBusy(true);
      const ok = await verifyPin(six);
      setBusy(false);
      if (ok) {
        close();
        nav('/parent/home');
      } else {
        setErr('Incorrect code.');
        // Clear after the shake animation so the dots visibly reset.
        setTimeout(() => {
          setCode('');
          setErr(null);
        }, 400);
      }
      return;
    }

    if (phase === 'setup-choose') {
      setChosenPin(six);
      setCode('');
      setPhase('setup-confirm');
      return;
    }

    if (phase === 'setup-confirm' && chosenPin) {
      if (six !== chosenPin) {
        setErr("Codes didn't match. Try again.");
        setTimeout(() => {
          setCode('');
          setChosenPin(null);
          setPhase('setup-choose');
          setErr(null);
        }, 500);
        return;
      }
      setBusy(true);
      try {
        await setPin(six);
        close();
        nav('/parent/home');
      } catch {
        setErr('Could not save the passcode. Try again.');
      } finally {
        setBusy(false);
      }
    }
  };

  const handleKey = (n: string) => {
    if (busy) return;
    if (err) setErr(null);
    if (n === '⌫') {
      setCode((c) => c.slice(0, -1));
      return;
    }
    if (code.length >= 6) return;
    const next = code + n;
    setCode(next);
    if (next.length === 6) {
      // Tiny delay so the final dot paints before we validate / advance.
      setTimeout(() => onComplete6(next), 120);
    }
  };

  const keys = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

  const title = (() => {
    switch (phase) {
      case 'loading':       return '…';
      case 'setup-choose':  return 'Pick a 6-digit passcode';
      case 'setup-confirm': return 'Enter it again to confirm';
      case 'verify':        return 'Parent passcode';
    }
  })();

  const subtitle = (() => {
    switch (phase) {
      case 'setup-choose':
        return "You'll use this to switch out of the kid view. Pick something easy for you to remember.";
      case 'setup-confirm':
        return 'Just to be sure we have it right.';
      default:
        return null;
    }
  })();

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); else onOpenChange(o); }}>
      <DialogContent className="max-w-[320px] rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-center">{title}</DialogTitle>
          {subtitle && (
            <p className="text-center text-[12px] text-muted-foreground -mt-1 leading-relaxed">
              {subtitle}
            </p>
          )}
        </DialogHeader>

        {/* Dots */}
        <div
          className={cn(
            'flex justify-center gap-3 py-4',
            err && 'animate-[shake_0.3s_ease-in-out]',
          )}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className={cn(
                'size-3 rounded-full border-2 transition-colors',
                i < code.length
                  ? 'bg-primary border-primary'
                  : 'border-muted-foreground/40',
              )}
            />
          ))}
        </div>

        {err && (
          <p className="text-center text-[12px] text-destructive -mt-2">
            {err}
          </p>
        )}

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-2">
          {keys.map((k, i) =>
            k === '' ? (
              <div key={i} aria-hidden />
            ) : (
              <button
                key={i}
                type="button"
                onClick={() => handleKey(k)}
                disabled={busy}
                className={cn(
                  'h-14 rounded-xl bg-card hover:bg-card/80 active:scale-95',
                  'text-xl font-semibold transition-transform disabled:opacity-40',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                )}
              >
                {k}
              </button>
            ),
          )}
        </div>

        <Button
          variant="ghost"
          onClick={close}
          className="mt-2"
          disabled={busy}
        >
          Cancel
        </Button>

        {/* Inline keyframes — no Tailwind config change needed */}
        <style>{`
          @keyframes shake {
            0%, 100% { transform: translateX(0); }
            25% { transform: translateX(-6px); }
            75% { transform: translateX(6px); }
          }
        `}</style>
      </DialogContent>
    </Dialog>
  );
}
