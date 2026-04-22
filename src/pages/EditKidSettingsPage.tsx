import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, KeyRound, Upload, Loader2 } from 'lucide-react';
import { useNostrLogin } from '@nostrify/react/login';
import { useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { NavTile } from '@/components/NavTile';
import { NoKidSelected } from '@/components/NoKidSelected';
import { ImageCropDialog } from '@/components/ImageCropDialog';
import { useSelectedKid } from '@/hooks/useSelectedKid';
import { useAuthor, parseAuthorEvent } from '@/hooks/useAuthor';
import { useUploadKidAvatar } from '@/hooks/useUploadKidAvatar';
import { usePublishKidProfile } from '@/hooks/usePublishKidProfile';
import { toast } from '@/hooks/useToast';
import { getKidSettings, setKidSettings } from '@/hooks/useKuboFamily';
import type { KidSettings, KuboModeration } from '@/hooks/useKuboFamily';
import { useDebounce } from '@/hooks/useDebounce';

/**
 * /parent/kid-settings — per-kid knobs for whichever kid is the active signer.
 *
 * Fields are persisted to the family record via setKidSettings().
 * Layout matches screen 04 in the contact sheet
 * (kid header, daily-limit slider, allowed-window inputs,
 * moderation radio).
 */
export function EditKidSettingsPage() {
  const nav = useNavigate();
  const kid = useSelectedKid();

  const [age, setAge]             = useState(6);
  const [dailyLimit, setDaily]    = useState(45); // minutes
  const [windowStart, setWStart]  = useState('16:00');
  const [windowEnd, setWEnd]      = useState('19:00');
  const [moderation, setMod]      = useState<KuboModeration>('mid');
  const [viewOnly, setViewOnly]   = useState(false);

  // Gate auto-save until after the mount-load effect has hydrated state,
  // so the load itself doesn't trigger a redundant write.
  const hasLoadedRef = useRef(false);

  // Load persisted settings when kid changes.
  useEffect(() => {
    if (!kid) return;
    hasLoadedRef.current = false;
    const s = getKidSettings(kid.pubkey);
    setAge(s.age);
    setDaily(s.dailyLimitMin);
    setWStart(s.windowStart);
    setWEnd(s.windowEnd);
    setMod(s.moderation);
    setViewOnly(s.viewOnly ?? false);
    hasLoadedRef.current = true;
  }, [kid?.pubkey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Assembled snapshot of all fields, used when building the patch to persist.
  const currentSettings = useMemo<KidSettings>(() => ({
    age,
    dailyLimitMin: dailyLimit,
    windowStart,
    windowEnd,
    moderation,
    viewOnly,
  }), [age, dailyLimit, windowStart, windowEnd, moderation, viewOnly]);

  // Per-field immediate persist (Ditto's settings-page convention).
  // Fire-and-forget; on failure we surface a toast but don't roll back — the
  // UI state reflects the user's intent and a retry will be written on next
  // interaction.
  const saveField = (patch: Partial<KidSettings>) => {
    if (!kid || !hasLoadedRef.current) return;
    setKidSettings(kid.pubkey, { ...currentSettings, ...patch }).catch((err) => {
      console.error('Failed to auto-save kid settings:', err);
      toast({
        title: 'Could not save settings',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'destructive',
      });
    });
  };

  // Time inputs fire on every keystroke; debounce so typing "16:30" produces
  // one write, not five. All other fields save immediately on change.
  const debouncedWindowStart = useDebounce(windowStart, 400);
  const debouncedWindowEnd   = useDebounce(windowEnd, 400);
  useEffect(() => {
    if (!kid || !hasLoadedRef.current) return;
    setKidSettings(kid.pubkey, {
      ...currentSettings,
      windowStart: debouncedWindowStart,
      windowEnd:   debouncedWindowEnd,
    }).catch((err) => {
      console.error('Failed to auto-save kid settings:', err);
    });
  }, [debouncedWindowStart, debouncedWindowEnd]); // eslint-disable-line react-hooks/exhaustive-deps

  // Avatar upload wiring. Hooks must be called unconditionally, so we call
  // them with `kid?.pubkey ?? ''` — useAuthor is gated on a truthy pubkey
  // internally and the mutations only read the pubkey inside the handler.
  const kidPubkey = kid?.pubkey ?? '';
  const { logins } = useNostrLogin();
  const { data: authorData } = useAuthor(kidPubkey || undefined);
  const metadata = authorData?.metadata;
  const queryClient = useQueryClient();

  const kidLoginAvailable = !!kidPubkey && logins.some(
    (l) => l.pubkey === kidPubkey && l.type === 'nsec',
  );

  const { mutateAsync: uploadKidAvatar, isPending: isUploading } = useUploadKidAvatar();
  const { mutateAsync: publishKidProfile, isPending: isPublishing } = usePublishKidProfile();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [cropState, setCropState] = useState<{ open: boolean; imageSrc: string } | null>(null);

  const openCropDialog = (file: File) => {
    const imageSrc = URL.createObjectURL(file);
    setCropState({ open: true, imageSrc });
  };

  const handleCropCancel = () => {
    if (cropState) URL.revokeObjectURL(cropState.imageSrc);
    setCropState(null);
  };

  const handleCropConfirm = async (blob: Blob) => {
    if (!cropState || !kidPubkey) return;
    URL.revokeObjectURL(cropState.imageSrc);
    setCropState(null);

    const file = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
    try {
      const url = await uploadKidAvatar({ file, kidPubkey });
      const event = await publishKidProfile({ patch: { picture: url }, kidPubkey });
      // Prime TanStack Query so every KidAvatar consumer repaints immediately.
      queryClient.setQueryData(['author', kidPubkey], parseAuthorEvent(event));
      toast({ title: 'Profile picture saved' });
    } catch (err) {
      console.error('Failed to save kid avatar:', err);
      toast({
        title: 'Could not save picture',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'destructive',
      });
    }
  };

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
        <Avatar className="size-12">
          <AvatarImage src={metadata?.picture} />
          <AvatarFallback className="bg-[#6366F1]" />
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold truncate">{kid.displayName}</div>
          <div className="text-[11px] text-muted-foreground">paired</div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!kidLoginAvailable || isUploading || isPublishing}
          onClick={() => fileInputRef.current?.click()}
          className="h-8 text-xs gap-1.5"
          aria-label={metadata?.picture ? 'Change profile picture' : 'Upload profile picture'}
          title={
            kidLoginAvailable
              ? undefined
              : "This kid's key isn't loaded on this device."
          }
        >
          {(isUploading || isPublishing)
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <Upload className="h-3 w-3" />}
          {metadata?.picture ? 'Change' : 'Upload'}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) openCropDialog(file);
            e.target.value = '';
          }}
        />
      </div>

      {/* Crop dialog */}
      {cropState && (
        <ImageCropDialog
          open={cropState.open}
          imageSrc={cropState.imageSrc}
          aspect={1}
          title="Crop profile picture"
          onCancel={handleCropCancel}
          onCrop={handleCropConfirm}
        />
      )}

      {/* Daily limit */}
      <Field label="Daily limit" value={`${dailyLimit} min`}>
        <Slider
          value={[dailyLimit]}
          min={15}
          max={180}
          step={5}
          onValueChange={(v) => {
            setDaily(v[0]);
            saveField({ dailyLimitMin: v[0] });
          }}
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
              onClick={() => {
                setMod(m);
                saveField({ moderation: m });
              }}
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

      {/* View-only mode */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <Label>View-only mode</Label>
          <p className="text-[11px] text-muted-foreground">
            Tapping a post won't open comments or details.
          </p>
        </div>
        <Switch
          checked={viewOnly}
          onCheckedChange={(v) => {
            setViewOnly(v);
            saveField({ viewOnly: v });
          }}
          aria-label="View-only mode"
        />
      </div>

      <NavTile
        icon={<KeyRound className="size-5" />}
        title="Backup keys"
        subtitle="View and save this kid's Nostr key"
        onClick={() => nav('/parent/keys')}
      />
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
