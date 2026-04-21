import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, KeyRound } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { NavTile } from '@/components/NavTile';
import { NoKidSelected } from '@/components/NoKidSelected';
import { useSelectedKid } from '@/hooks/useSelectedKid';

type Moderation = 'low' | 'mid' | 'high';

/**
 * /parent/kid-settings — per-kid knobs for whichever kid is the active signer.
 *
 * Visual only. Fields are local useState; nothing is persisted. The
 * data-layer PR will wire these to a kid-settings addressable event
 * via read-modify-write. Layout matches screen 04 in the contact sheet
 * (kid header, age slider, daily-limit slider, allowed-window inputs,
 * moderation radio).
 */
export function EditKidSettingsPage() {
  const nav = useNavigate();
  const kid = useSelectedKid();

  const [age, setAge]             = useState(6);
  const [dailyLimit, setDaily]    = useState(45); // minutes
  const [windowStart, setWStart]  = useState('16:00');
  const [windowEnd, setWEnd]      = useState('19:00');
  const [moderation, setMod]      = useState<Moderation>('mid');

  if (!kid) {
    return <NoKidSelected title="Kid settings" />;
  }

  return (
    <div className="flex flex-col gap-5 px-4 pt-2 pb-6">
      {/* Back + title */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="size-9 rounded-full"
          onClick={() => nav('/parent/home')}
          aria-label="Back"
        >
          <ChevronLeft className="size-5" />
        </Button>
        <h1 className="text-base font-semibold flex-1">Kid settings</h1>
      </div>

      {/* Kid identity block */}
      <div className="flex items-center gap-3 px-1">
        <div className="size-12 rounded-full bg-[#6366F1]" aria-hidden />
        <div className="min-w-0">
          <div className="text-base font-semibold truncate">{kid.displayName}</div>
          <div className="text-[11px] text-muted-foreground">age {age} · paired</div>
        </div>
      </div>

      {/* Age */}
      <Field label="Age" value={`${age} years`}>
        <Slider
          value={[age]}
          min={3}
          max={14}
          step={1}
          onValueChange={(v) => setAge(v[0])}
          aria-label="Age"
        />
      </Field>

      {/* Daily limit */}
      <Field label="Daily limit" value={`${dailyLimit} min`}>
        <Slider
          value={[dailyLimit]}
          min={15}
          max={180}
          step={5}
          onValueChange={(v) => setDaily(v[0])}
          aria-label="Daily limit in minutes"
        />
      </Field>

      {/* Allowed window */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <Label>Allowed window</Label>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {windowStart} – {windowEnd}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <TimeInput value={windowStart} onChange={setWStart} aria-label="Window start" />
          <span className="text-muted-foreground">–</span>
          <TimeInput value={windowEnd}   onChange={setWEnd}   aria-label="Window end" />
        </div>
      </div>

      {/* Moderation */}
      <div className="flex flex-col gap-2">
        <Label>Moderation level</Label>
        <div
          className="grid grid-cols-3 gap-2"
          role="radiogroup"
          aria-label="Moderation level"
        >
          {(['low', 'mid', 'high'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={moderation === m}
              onClick={() => setMod(m)}
              className={cn(
                'h-11 rounded-xl text-sm font-medium capitalize transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                moderation === m
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card text-foreground hover:bg-card/80',
              )}
            >
              {m}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {moderation === 'low'  && 'Only content flagged as unsafe is hidden.'}
          {moderation === 'mid'  && 'Balanced — blocks unsafe and borderline content.'}
          {moderation === 'high' && 'Strict — only content from the inner-circle graph.'}
        </p>
      </div>

      <NavTile
        icon={<KeyRound className="size-5" />}
        title="Backup keys"
        subtitle="View and save this kid's Nostr key"
        onClick={() => nav('/parent/keys')}
      />

      <div className="h-4" />

      <Button size="lg" className="w-full h-12 rounded-full">
        Save changes
      </Button>
    </div>
  );
}

function Field({
  label, value, children,
}: {
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <Label>{label}</Label>
        <span className="text-[11px] text-muted-foreground tabular-nums">{value}</span>
      </div>
      {children}
    </div>
  );
}

function TimeInput({
  value, onChange, ...rest
}: {
  value: string;
  onChange: (v: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'>) {
  return (
    <input
      type="time"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'flex-1 h-11 px-3 rounded-xl bg-card text-foreground text-sm',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
      )}
      {...rest}
    />
  );
}
