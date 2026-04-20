import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  CategoryChips,
  type Category,
} from '@/components/feed/CategoryChips';

/**
 * /parent/upload — content uploader.
 *
 * Visual only. The drop zone is decorative (no file handling); Publish
 * just navigates back home. A later PR wires useUploadFile (Blossom)
 * and a NIP-71 video event publish.
 */
export function ContentUploaderPage() {
  const nav = useNavigate();

  const [title,       setTitle]       = useState('');
  const [description, setDescription] = useState('');
  const [category,    setCategory]    = useState<Category>('animals');

  const canPublish = title.trim().length > 0;

  return (
    <div className="flex flex-col gap-4 pt-2 pb-6 min-h-dvh">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4">
        <Button
          variant="ghost"
          size="icon"
          className="size-9 rounded-full"
          onClick={() => nav(-1)}
          aria-label="Close"
        >
          <X className="size-5" />
        </Button>
        <h1 className="text-lg font-semibold flex-1">Upload a video</h1>
      </div>

      {/* Drop zone */}
      <button
        type="button"
        className="mx-4 aspect-video rounded-2xl border-2 border-dashed border-muted-foreground/25 bg-card/30 flex flex-col items-center justify-center gap-2 text-muted-foreground hover:bg-card/60 transition-colors"
      >
        <Upload className="size-6" />
        <span className="text-[13px]">Tap to select</span>
        <span className="text-[11px] text-muted-foreground/70">
          mp4, mov · up to 200 MB
        </span>
      </button>

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

      {/* Category */}
      <div className="flex flex-col gap-2">
        <Label className="px-4">Category</Label>
        <CategoryChips
          value={category}
          options={['animals', 'music', 'craft', 'stories']}
          onChange={setCategory}
        />
      </div>

      <div className="flex-1" />

      {/* Publish */}
      <div className="px-4">
        <Button
          size="lg"
          className="w-full h-12 rounded-full"
          disabled={!canPublish}
          onClick={() => nav('/parent/home')}
        >
          Publish
        </Button>
      </div>
    </div>
  );
}
