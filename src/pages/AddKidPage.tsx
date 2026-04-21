import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Loader2, Upload } from 'lucide-react';
import { useNostr } from '@nostrify/react';
import { useNostrLogin } from '@nostrify/react/login';
import { useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ImageCropDialog } from '@/components/ImageCropDialog';
import { toast } from '@/hooks/useToast';
import { useLoginActions } from '@/hooks/useLoginActions';
import { useAppContext } from '@/hooks/useAppContext';
import { useKuboFamily } from '@/hooks/useKuboFamily';
import { useUploadKidAvatar } from '@/hooks/useUploadKidAvatar';
import { usePublishKidProfile } from '@/hooks/usePublishKidProfile';
import { onboardIdentity, publishInitialEncryptedSettings } from '@/lib/kuboOnboarding';
import { DEFAULT_KID_FEED_SETTINGS } from '@/lib/extraKinds';
import { parseAuthorEvent } from '@/hooks/useAuthor';

interface ParentHandoffState {
  parentPubkey?: string;
  parentDisplayName?: string;
}

/**
 * /onboard/add-kid — kid onboarding screen, reused for:
 *   • The initial onboarding flow (parent handoff via router state).
 *   • Adding further kids from the parent dashboard (parent read from
 *     kubo:family).
 *
 * After creating the kid, this page flips the active signer to the new kid so
 * the parent can immediately configure them — the parent dashboard scopes its
 * settings (follows, feed, relays) to whichever kid is logins[0].
 */
export function AddKidPage() {
  const nav = useNavigate();
  const { nostr } = useNostr();
  const { config } = useAppContext();
  const location = useLocation();
  const login = useLoginActions();
  const { setLogin } = useNostrLogin();
  const { family, setFamily, addKid } = useKuboFamily();

  const queryClient = useQueryClient();
  const { mutateAsync: uploadKidAvatar } = useUploadKidAvatar();
  const { mutateAsync: publishKidProfile } = usePublishKidProfile();

  const handoff = (location.state ?? {}) as ParentHandoffState;
  const parentPubkey = handoff.parentPubkey ?? family?.parentPubkey;
  const parentDisplayName = handoff.parentDisplayName ?? family?.parentDisplayName;

  const isFirstKid = (family?.kids.length ?? 0) === 0;

  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Optional avatar pick — parent can skip. If a blob is staged, we upload
  // and publish *after* onboardIdentity resolves, wrapped in try/catch so a
  // failed upload never blocks kid creation (the identity is already persisted).
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [stagedBlob, setStagedBlob] = useState<Blob | null>(null);
  const [stagedPreview, setStagedPreview] = useState<string | null>(null);
  const [cropState, setCropState] = useState<{ open: boolean; imageSrc: string } | null>(null);

  useEffect(() => {
    return () => {
      if (stagedPreview) URL.revokeObjectURL(stagedPreview);
    };
    // stagedPreview is intentionally tracked via ref cleanup on unmount — we
    // re-create it on every new crop and revoke the previous one in the
    // handler below, so this effect is just a final safety net.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCropState({ open: true, imageSrc: URL.createObjectURL(file) });
    }
    e.target.value = '';
  };

  const handleCropCancel = () => {
    if (cropState) URL.revokeObjectURL(cropState.imageSrc);
    setCropState(null);
  };

  const handleCropConfirm = (blob: Blob) => {
    if (!cropState) return;
    URL.revokeObjectURL(cropState.imageSrc);
    setCropState(null);
    if (stagedPreview) URL.revokeObjectURL(stagedPreview);
    setStagedBlob(blob);
    setStagedPreview(URL.createObjectURL(blob));
  };

  const canSubmit = name.trim().length >= 1 && !submitting;

  const handleAdd = async () => {
    if (!canSubmit) return;
    if (!parentPubkey || !parentDisplayName) {
      // Genuinely unbound — no handoff state and no saved family. Bounce.
      nav('/onboard/welcome', { replace: true });
      return;
    }
    setSubmitting(true);
    try {
      const trimmed = name.trim();
      const identity = await onboardIdentity({
        nostr,
        name: trimmed,
        clientTagName: config.clientName ?? config.appName,
        clientNaddr: config.client,
      });
      login.nsec(identity.nsec);

      // Seed the kid's encrypted feedSettings — visual content only (photos,
      // videos, vines). Signed directly with the kid's nsec because
      // useEncryptedSettings closes over useCurrentUser(), which is still
      // pointing at the parent in this handler.
      try {
        await publishInitialEncryptedSettings({
          nostr,
          nsec: identity.nsec,
          settings: { feedSettings: DEFAULT_KID_FEED_SETTINGS },
          appId: config.appId,
          appName: config.appName,
          clientNaddr: config.client,
        });
      } catch (err) {
        // Non-fatal: the kid will just start with the app-wide feed defaults
        // and the parent can adjust via /parent/kid/:id/feed-settings.
        console.warn('Failed to seed kid encrypted settings:', err);
      }

      // Optional avatar upload — non-blocking. If this fails the kid is still
      // created cleanly; parent can set a picture later via /parent/kid-settings.
      // Uses the nsec-form of the hooks because Nostrify's `logins` state is
      // updated asynchronously by `login.nsec(...)` above and may not yet
      // contain the new kid inside this handler.
      if (stagedBlob) {
        const file = new File([stagedBlob], 'avatar.jpg', { type: 'image/jpeg' });
        try {
          const url = await uploadKidAvatar({ file, nsec: identity.nsec });
          const event = await publishKidProfile({
            patch: { picture: url },
            nsec: identity.nsec,
          });
          queryClient.setQueryData(
            ['author', identity.pubkey],
            parseAuthorEvent(event),
          );
        } catch (err) {
          console.warn('Kid avatar upload failed (non-fatal):', err);
          toast({
            title: 'Picture upload failed',
            description: `${trimmed} was added but without a picture. You can add one later.`,
          });
        }
      }

      if (isFirstKid) {
        await setFamily({
          parentPubkey,
          parentDisplayName,
          kids: [{ pubkey: identity.pubkey, displayName: trimmed }],
        });
      } else {
        await addKid({ pubkey: identity.pubkey, displayName: trimmed });
      }

      // Make the freshly-created kid the active signer so the parent lands on
      // /parent/home already scoped to them. Nostrify's login id for an nsec
      // login is deterministic (`nsec:<pubkey>`), so we can reconstruct it
      // without reading `logins` (which would be stale in this same handler).
      setLogin(`nsec:${identity.pubkey}`);

      nav('/parent/home', { replace: true });
    } catch (err) {
      console.error('Kid onboarding failed:', err);
      toast({
        title: 'Could not add kid',
        description: 'Something went wrong while setting up the kid account. Please try again.',
        variant: 'destructive',
      });
      setSubmitting(false);
    }
  };

  const title = isFirstKid ? 'Add your first kid' : 'Add a kid';

  return (
    <div className="flex-1 flex flex-col max-w-sm mx-auto w-full pt-4 pb-2">
      <div className="flex-1 flex flex-col gap-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">
            We'll set up a Kubo identity for them. You'll manage who they
            follow and who can reach them from your parent dashboard.
          </p>
        </div>

        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={submitting}
            className="relative size-20 rounded-full overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60"
            aria-label={stagedPreview ? 'Change profile picture' : 'Add profile picture (optional)'}
          >
            <Avatar className="size-20">
              {stagedPreview && <AvatarImage src={stagedPreview} />}
              <AvatarFallback className="bg-[#6366F1] text-white">
                <Upload className="size-5 opacity-80" />
              </AvatarFallback>
            </Avatar>
          </button>
          <p className="text-[11px] text-muted-foreground">
            {stagedPreview ? 'Tap to change' : 'Profile picture (optional)'}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFilePick}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="kid-name">Kid's name</Label>
          <Input
            id="kid-name"
            autoFocus
            placeholder="Mia"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-12 rounded-xl text-base"
            disabled={submitting}
          />
          <p className="text-xs text-muted-foreground">
            Just a display name — you can change it anytime.
          </p>
        </div>
      </div>

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

      <Button
        size="lg"
        className="w-full h-12 rounded-full"
        disabled={!canSubmit}
        onClick={handleAdd}
      >
        {submitting
          ? <><Loader2 className="size-4 mr-2 animate-spin" /> Adding…</>
          : 'Add kid'}
      </Button>
    </div>
  );
}
