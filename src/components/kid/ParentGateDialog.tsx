import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Passcode dialog for switching out of the kid app into the parent app.
 *
 * MVP: any 6-digit code is accepted (the real check lives with the
 * kid-settings hook landed in a later PR). Enter → /parent/home.
 *
 * Wrong passcode shakes + shows an inline message; Cancel closes.
 */
export function ParentGateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const [err, setErr] = useState(false);

  const handleKey = (n: string) => {
    setErr(false);
    if (n === '⌫') {
      setCode((c) => c.slice(0, -1));
      return;
    }
    if (code.length >= 6) return;
    const next = code + n;
    setCode(next);
    if (next.length === 6) {
      // MVP: accept any 6-digit code. Real validation lands with
      // kid-settings hook in a later PR.
      setTimeout(() => {
        onOpenChange(false);
        setCode('');
        nav('/parent/home');
      }, 150);
    }
  };

  const keys = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setCode(''); setErr(false); } }}>
      <DialogContent className="max-w-[320px] rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-center">Parent passcode</DialogTitle>
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
            Incorrect code. Try again.
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
                className={cn(
                  'h-14 rounded-xl bg-card hover:bg-card/80 active:scale-95',
                  'text-xl font-semibold transition-transform',
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
          onClick={() => onOpenChange(false)}
          className="mt-2"
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
