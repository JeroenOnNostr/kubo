import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, Loader2, Upload } from 'lucide-react';
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
import { KUBO_DEFAULT_KID_PACK_ATAG } from '@/lib/helpContent';
import { parseAuthorEvent } from '@/hooks/useAuthor';
import { clearOnboardingParent, getOnboardingParent } from '@/lib/onboardingParent';

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
  // Fallback chain: explicit router state (fresh nav) → committed family
  // record (returning parent with kids) → transient onboarding-parent key
  // (logged-in parent who reloaded mid-flow before any kid was written).
  const stashed = !handoff.parentPubkey && !family ? getOnboardingParent() : null;
  const parentPubkey =
    handoff.parentPubkey ?? family?.parentPubkey ?? stashed?.parentPubkey;
  const parentDisplayName =
    handoff.parentDisplayName ?? family?.parentDisplayName ?? stashed?.parentDisplayName;

  const isFirstKid = (family?.kids.length ?? 0) === 0;

  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // When the kid is created but the avatar upload fails, we stop short of
  // navigating and surface a persistent retry affordance on the avatar
  // tile. `pendingAvatar` holds the data we'd need to retry without a
  // second identity creation: the new kid's pubkey+nsec and the finishing
  // handoff (navigation destination + family write that still needs doing).
  const [pendingAvatar, setPendingAvatar] = useState<
    | null
    | {
        kidPubkey: string;
        kidNsec: `nsec1${string}`;
        kidDisplayName: string;
        finish: () => void;
      }
  >(null);
  const [retrying, setRetrying] = useState(false);

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

  const KID_NAME_MAX = 30;
  const trimmedNameLength = name.trim().length;
  const canSubmit =
    trimmedNameLength >= 1 &&
    trimmedNameLength <= KID_NAME_MAX &&
    !submitting;

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

      // Finishing handoff — runs either after a successful avatar upload,
      // or after the user opts to skip a failed upload. Writing the family
      // record is what anchors the kid permanently; doing it *after* the
      // avatar attempt means retrying isn't blocked by a missing family
      // entry.
      const finish = () => {
        (async () => {
          if (isFirstKid) {
            await setFamily({
              parentPubkey,
              parentDisplayName,
              kids: [{ pubkey: identity.pubkey, displayName: trimmed }],
              // Seed the default kid-friendly Follow pack so the feed isn't
              // empty during the first-run tour (KUBO-064). Mirrors the
              // seeding that addKid() does for subsequently-added kids.
              feedSources: {
                [identity.pubkey]: {
                  relays: [],
                  communities: [],
                  packs: [KUBO_DEFAULT_KID_PACK_ATAG],
                },
              },
            });
          } else {
            await addKid({ pubkey: identity.pubkey, displayName: trimmed });
          }

          // Family record is now committed — clear the transient handoff
          // key. From here on, family?.parentPubkey is the source of truth
          // for "who is the parent on this device."
          clearOnboardingParent();

          // Make the freshly-created kid the active signer and drop the
          // parent straight into the kid app, so onboarding ends on a
          // visible feed rather than the parent dashboard. From here a
          // later session will overlay tooltips that walk the parent into
          // configuring the feed. Nostrify's login id for an nsec login is
          // deterministic (`nsec:<pubkey>`), so we can reconstruct it
          // without reading `logins` (which would be stale in this same
          // handler).
          setLogin(`nsec:${identity.pubkey}`);
          nav('/kid', { replace: true });
        })();
      };

      // Optional avatar upload — non-blocking for kid creation, but if it
      // fails we keep the user here with a persistent inline retry affordance
      // on the avatar tile (better than a toast that disappears).
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
          setPendingAvatar({
            kidPubkey: identity.pubkey,
            kidNsec: identity.nsec,
            kidDisplayName: trimmed,
            finish,
          });
          setSubmitting(false);
          return; // stop here; user decides retry vs skip
        }
      }

      finish();
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

  const retryAvatar = async () => {
    if (!pendingAvatar || !stagedBlob) return;
    setRetrying(true);
    try {
      const file = new File([stagedBlob], 'avatar.jpg', { type: 'image/jpeg' });
      const url = await uploadKidAvatar({ file, nsec: pendingAvatar.kidNsec });
      const event = await publishKidProfile({
        patch: { picture: url },
        nsec: pendingAvatar.kidNsec,
      });
      queryClient.setQueryData(
        ['author', pendingAvatar.kidPubkey],
        parseAuthorEvent(event),
      );
      const finish = pendingAvatar.finish;
      setPendingAvatar(null);
      finish();
    } catch (err) {
      console.warn('Avatar retry failed:', err);
      toast({
        title: 'Still couldn’t upload the picture',
        description: 'Check your connection and try once more, or skip for now.',
        variant: 'destructive',
      });
    } finally {
      setRetrying(false);
    }
  };

  const skipAvatar = () => {
    if (!pendingAvatar) return;
    const finish = pendingAvatar.finish;
    setPendingAvatar(null);
    finish();
  };

  const title = isFirstKid ? 'Add your first kid' : 'Add a kid';

  return (
    <form
      className="flex-1 flex flex-col max-w-sm mx-auto w-full pt-4 pb-2"
      onSubmit={(e) => {
        e.preventDefault();
        handleAdd();
      }}
    >
      <div className="flex-1 flex flex-col gap-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">
            Just a display name — you can change it anytime. It will be
            publicly visible.
          </p>
        </div>

        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={submitting || retrying || !!pendingAvatar}
            className="relative size-20 rounded-full overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60"
            aria-label={stagedPreview ? 'Change profile picture' : 'Add profile picture (optional)'}
          >
            <Avatar className="size-20">
              {stagedPreview && <AvatarImage src={stagedPreview} />}
              <AvatarFallback className="bg-primary/10 text-primary border-2 border-dashed border-primary/30">
                <Upload className="size-5" />
              </AvatarFallback>
            </Avatar>
            {pendingAvatar && (
              <span
                className="absolute inset-0 bg-destructive/20 ring-2 ring-destructive flex items-center justify-center"
                aria-hidden
              >
                <AlertTriangle className="size-6 text-destructive drop-shadow" />
              </span>
            )}
          </button>
          {pendingAvatar ? (
            <div className="flex flex-col items-center gap-2 mt-1">
              <p className="text-[12px] text-destructive font-medium">
                Couldn’t upload the picture.
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="rounded-full"
                  onClick={retryAvatar}
                  disabled={retrying}
                >
                  {retrying ? (
                    <>
                      <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                      Retrying…
                    </>
                  ) : (
                    'Retry upload'
                  )}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="rounded-full"
                  onClick={skipAvatar}
                  disabled={retrying}
                >
                  Skip for now
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              {stagedPreview ? 'Tap to change' : 'Profile picture (optional)'}
            </p>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFilePick}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="kid-name">Kid's name</Label>
            {name.length > 0 && (
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {name.length}/{KID_NAME_MAX}
              </span>
            )}
          </div>
          <Input
            id="kid-name"
            autoFocus
            enterKeyHint="go"
            placeholder="Mia"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={KID_NAME_MAX}
            className="h-12 rounded-xl text-base"
            disabled={submitting}
          />
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

      {/*
        While the avatar is pending retry, the kid is already saved — the
        primary CTA is whichever retry/skip action lives on the avatar tile
        above, not "Add kid" again. Hide the main button during that state
        so there's only one obvious next move.
      */}
      {!pendingAvatar && (
        <Button
          type="submit"
          size="lg"
          className="w-full h-12 rounded-full"
          disabled={!canSubmit}
        >
          {submitting
            ? <><Loader2 className="size-4 mr-2 animate-spin" /> Adding…</>
            : 'Add kid'}
        </Button>
      )}
    </form>
  );
}
