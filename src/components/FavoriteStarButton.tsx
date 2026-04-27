import { Star } from 'lucide-react';
import { useKidFavorites } from '@/hooks/useKidFavorites';

/**
 * Kid-mode star button for the NoteCard action bar.
 *
 * The hook lives inside this component (not in NoteCard) so it only mounts
 * when `av.showFavorite` is true — i.e. only on a kid signer with the favorite
 * action enabled. Otherwise an entire feed of NoteCards would each subscribe
 * to the favorites query, even for non-kid users.
 *
 * Mirrors the structural pattern used by ReactionButton.
 */
export function FavoriteStarButton({ eventId }: { eventId: string }) {
  const { isFavorited, toggleFavorite } = useKidFavorites();
  const favorited = isFavorited(eventId);

  return (
    <button
      className={`flex items-center gap-1.5 p-2 rounded-full transition-colors ${favorited ? "text-amber-400 hover:text-amber-400/80 hover:bg-amber-400/10" : "text-muted-foreground hover:text-amber-400 hover:bg-amber-400/10"}`}
      title={favorited ? 'Remove favorite' : 'Favorite'}
      aria-pressed={favorited}
      disabled={toggleFavorite.isPending}
      onClick={(e) => {
        e.stopPropagation();
        toggleFavorite.mutate(eventId);
      }}
    >
      <Star className={`size-5 ${favorited ? 'fill-current' : ''}`} />
    </button>
  );
}
