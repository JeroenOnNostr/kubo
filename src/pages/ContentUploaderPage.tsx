import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronUp, Loader2, Upload } from 'lucide-react';
import { NUser, useNostrLogin } from '@nostrify/react/login';
import { useNostr } from '@nostrify/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useKuboFamily } from '@/hooks/useKuboFamily';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppContext } from '@/hooks/useAppContext';
import { uploadFileWithSigner } from '@/hooks/useUploadFile';
import { getEffectiveBlossomServers } from '@/lib/appBlossom';
import { getEffectiveRelays } from '@/lib/appRelays';
import { toast } from '@/hooks/useToast';

import type { NostrSigner } from '@nostrify/nostrify';

/** 200 MB in bytes. */
const MAX_FILE_SIZE = 200 * 1024 * 1024;

type PublishStage = 'uploading' | 'signing' | 'publishing';

const STAGE_LABELS: Record<PublishStage, string> = {
  uploading: 'Uploading to Blossom…',
  signing: 'Signing event…',
  publishing: 'Publishing…',
};

/**
 * /parent/upload — content uploader.
 *
 * Uploads media to Blossom, then publishes a NIP-71 kind 21 (video) or
 * NIP-68 kind 20 (picture) event signed by the selected family member.
 */
export function ContentUploaderPage() {
  const nav = useNavigate();
  const { nostr } = useNostr();
  const { logins } = useNostrLogin();
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const { family } = useKuboFamily();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  // File state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Publisher selection — defaults to parent
  const [publisherPubkey, setPublisherPubkey] = useState<string | null>(null);

  // Advanced overrides
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedBlossomServer, setSelectedBlossomServer] = useState<string | null>(null);
  const [selectedRelay, setSelectedRelay] = useState<string | null>(null);

  // Stage-based progress
  const [stage, setStage] = useState<PublishStage | null>(null);

  // Default publisher to parent when family loads
  useEffect(() => {
    if (family && !publisherPubkey) {
      setPublisherPubkey(family.parentPubkey);
    }
  }, [family, publisherPubkey]);

  // Revoke object URL on unmount or when file changes
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const isVideo = selectedFile?.type.startsWith('video/');
  const isImage = selectedFile?.type.startsWith('image/');

  // Effective server/relay lists for the advanced dropdowns
  const blossomServers = getEffectiveBlossomServers(
    config.blossomServerMetadata,
    config.useAppBlossomServers,
  );
  const effectiveRelays = getEffectiveRelays(
    config.relayMetadata,
    config.useAppRelays,
  );
  const writeRelays = effectiveRelays.relays.filter((r) => r.write);

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('video/') && !file.type.startsWith('image/')) {
      toast({ title: 'Unsupported file type', description: 'Please select a video or image file.', variant: 'destructive' });
      e.target.value = '';
      return;
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      toast({ title: 'File too large', description: 'Maximum file size is 200 MB.', variant: 'destructive' });
      e.target.value = '';
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    e.target.value = '';
  }

  function getSignerForPubkey(pubkey: string): NostrSigner {
    // Active user fast path — reuses the existing signer (including a live
    // bunker NConnectSigner) instead of rebuilding it.
    if (user && pubkey === user.pubkey) {
      return user.signer;
    }
    // Rebuild a signer from any stored login record for this pubkey —
    // covers parent-as-extension/bunker while a kid is the active login,
    // and parent-as-nsec or kid-as-nsec from any active session.
    const login = logins.find((l) => l.pubkey === pubkey);
    if (!login) {
      throw new Error("That account's key isn't loaded on this device.");
    }
    switch (login.type) {
      case 'nsec':
        return NUser.fromNsecLogin(login).signer;
      case 'extension':
        return NUser.fromExtensionLogin(login).signer;
      case 'bunker':
        return NUser.fromBunkerLogin(login, nostr).signer;
      default:
        throw new Error("That account's key isn't loaded on this device.");
    }
  }

  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile || !publisherPubkey) {
        throw new Error('File and publisher are required.');
      }

      // Explicit file type guard
      if (!isVideo && !isImage) {
        throw new Error('Unsupported file type. Please select a video or image.');
      }

      const signer = getSignerForPubkey(publisherPubkey);

      // Stage 1: Upload to Blossom
      setStage('uploading');
      const servers = selectedBlossomServer ? [selectedBlossomServer] : blossomServers;
      const uploadTags = await uploadFileWithSigner(selectedFile, signer, servers);
      const uploadedUrl = uploadTags[0][1];

      // Stage 2: Sign the event
      setStage('signing');

      const tags: string[][] = [];
      tags.push(['title', title.trim()]);

      // imeta tag with upload metadata
      const imetaFields: string[] = [`url ${uploadedUrl}`];
      const mimeTag = uploadTags.find((t) => t[0] === 'm');
      if (mimeTag) imetaFields.push(`m ${mimeTag[1]}`);
      const hashTag = uploadTags.find((t) => t[0] === 'x');
      if (hashTag) imetaFields.push(`x ${hashTag[1]}`);
      const sizeTag = uploadTags.find((t) => t[0] === 'size');
      if (sizeTag) imetaFields.push(`size ${sizeTag[1]}`);
      tags.push(['imeta', ...imetaFields]);

      const kind = isVideo ? 21 : 20;
      const altPrefix = isVideo ? 'Video' : 'Photo';
      tags.push(['alt', `${altPrefix}: ${title.trim()}`]);
      tags.push(['client', config.clientName ?? config.appName]);

      const event = await signer.signEvent({
        kind,
        content: description.trim(),
        tags,
        created_at: Math.floor(Date.now() / 1000),
      });

      // Stage 3: Publish to relay(s)
      setStage('publishing');

      if (selectedRelay) {
        // Use the pool's relay instance — reuses existing connection if open
        const relay = nostr.relay(selectedRelay);
        await relay.event(event, { signal: AbortSignal.timeout(5000) });
      } else {
        await nostr.event(event, { signal: AbortSignal.timeout(5000) });
      }

      return event;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      toast({ title: 'Published!' });
      nav('/parent/home');
    },
    onError: (err) => {
      console.error('Upload/publish failed:', err);
      toast({
        title: 'Upload failed',
        description: err instanceof Error ? err.message : 'Something went wrong',
        variant: 'destructive',
      });
    },
    onSettled: () => {
      setStage(null);
    },
  });

  const canPublish = title.trim().length > 0
    && selectedFile !== null
    && publisherPubkey !== null
    && !publishMutation.isPending;

  return (
    <div className="flex flex-col sidebar:min-h-dvh max-sidebar:kubo-upload-height max-sidebar:overflow-hidden">
      {/*
        Scrollable form region. Keeping the fields in their own scroll
        container — with the Publish footer as a flex sibling below it — means
        the footer can never paint over the inputs when the soft keyboard
        opens. `interactive-widget=resizes-content` (index.html) shrinks this
        bounded column on keyboard show/hide, so the reflow needs no JS.
        (KUBO-217)
      */}
      <div className="flex flex-col gap-4 pt-2 pb-6 max-sidebar:flex-1 max-sidebar:min-h-0 max-sidebar:overflow-y-auto">
        {/* Drop zone / preview */}
        {previewUrl && selectedFile ? (
          <div className="mx-4 relative aspect-video rounded-2xl overflow-hidden bg-black">
            {isVideo ? (
              <video
                src={previewUrl}
                controls
                muted
                playsInline
                className="size-full object-contain"
              />
            ) : (
              <img
                src={previewUrl}
                alt="Preview"
                className="size-full object-cover"
              />
            )}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="absolute bottom-2 right-2 rounded-full bg-black/60 px-3 py-1 text-xs text-white hover:bg-black/80 transition-colors"
            >
              Change
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mx-4 aspect-video rounded-2xl border-2 border-dashed border-muted-foreground/25 bg-card/30 flex flex-col items-center justify-center gap-2 text-muted-foreground hover:bg-card/60 transition-colors"
          >
            <Upload className="size-6" />
            <span className="text-[13px]">Tap to select</span>
            <span className="text-[11px] text-muted-foreground/70">
              Video or image · up to 200 MB
            </span>
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="video/*,image/*"
          className="hidden"
          onChange={handleFilePick}
        />

        {/* Publish as */}
        {family && (
          <div className="px-4 flex flex-col gap-2">
            <Label>Publish as</Label>
            <Select value={publisherPubkey ?? ''} onValueChange={setPublisherPubkey}>
              <SelectTrigger className="h-11 rounded-xl">
                <SelectValue placeholder="Select who publishes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={family.parentPubkey}>
                  {family.parentDisplayName} (parent)
                </SelectItem>
                {family.kids.map((kid) => (
                  <SelectItem key={kid.pubkey} value={kid.pubkey}>
                    {kid.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Title */}
        <div className="px-4 flex flex-col gap-2">
          <Label htmlFor="upl-title">Title</Label>
          <Input
            id="upl-title"
            placeholder="My octopus video"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-11 rounded-xl"
          />
        </div>

        {/* Description */}
        <div className="px-4 flex flex-col gap-2">
          <Label htmlFor="upl-desc">
            Description <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Textarea
            id="upl-desc"
            placeholder="What's this video about?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-24 rounded-xl resize-none"
          />
        </div>

        {/* Advanced options */}
        <div className="px-4">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {showAdvanced ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            Advanced options
          </button>

          {showAdvanced && (
            <div className="flex flex-col gap-4 mt-3">
              {/* Blossom server */}
              <div className="flex flex-col gap-2">
                <Label>Blossom server</Label>
                <Select
                  value={selectedBlossomServer ?? '__all__'}
                  onValueChange={(v) => setSelectedBlossomServer(v === '__all__' ? null : v)}
                >
                  <SelectTrigger className="h-11 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All servers (default)</SelectItem>
                    {blossomServers.map((server) => (
                      <SelectItem key={server} value={server}>
                        {server.replace(/^https?:\/\//, '').replace(/\/+$/, '')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Relay */}
              <div className="flex flex-col gap-2">
                <Label>Publish to place</Label>
                <Select
                  value={selectedRelay ?? '__all__'}
                  onValueChange={(v) => setSelectedRelay(v === '__all__' ? null : v)}
                >
                  <SelectTrigger className="h-11 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All places (default)</SelectItem>
                    {writeRelays.map((relay) => (
                      <SelectItem key={relay.url} value={relay.url}>
                        {relay.url.replace(/^wss?:\/\//, '').replace(/\/+$/, '')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>
      </div>

      {/*
        Publish — a flex sibling below the scroll region, so it can never
        overlap the fields when the keyboard shrinks the viewport (mobile).
        On desktop (`sidebar:`) there is no bottom nav and the column is not
        height-bounded, so it reverts to the original sticky-above-nav
        behavior via the inline `bottom` offset.
      */}
      <div
        className="shrink-0 px-4 pt-3 pb-3 bg-gradient-to-t from-background via-background to-background/0 sidebar:sticky sidebar:inset-x-0"
        style={{ bottom: 'calc(var(--bottom-nav-height, 56px) + env(safe-area-inset-bottom, 0px))' }}
      >
        <Button
          size="lg"
          className="w-full h-12 rounded-full"
          disabled={!canPublish}
          onClick={() => publishMutation.mutate()}
        >
          {publishMutation.isPending ? (
            <>
              <Loader2 className="size-5 animate-spin mr-2" />
              {stage ? STAGE_LABELS[stage] : 'Publishing…'}
            </>
          ) : (
            'Publish'
          )}
        </Button>
      </div>
    </div>
  );
}
