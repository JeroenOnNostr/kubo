import { Star } from 'lucide-react';
import { useKidFavorites } from '@/hooks/useKidFavorites';

/**
 * Kid-mode star button for favoriting posts.
 *
 * The hook lives inside this component (not in NoteCard) so it only mounts
 * when `av.showFavorite` is true — i.e. only on a kid signer with the favorite
 * action enabled. Otherwise an entire feed of NoteCards would each subscribe
 * to the favorites query, even for non-kid users.
 *
 * `overlay` positions the star absolutely in the top-right of a `relative`
 * parent (the post tile). Default inline mode keeps action-bar styling.
 */
export function FavoriteStarButton({ eventId, overlay }: { eventId: string; overlay?: boolean }) {
  const { isFavorited, toggleFavorite } = useKidFavorites();
  const favorited = isFavorited(eventId);

  const colorClasses = favorited
    ? "text-amber-400 hover:text-amber-400/80 hover:bg-amber-400/10"
    : "text-muted-foreground hover:text-amber-400 hover:bg-amber-400/10";

  return (
    <button
      className={
        overlay
          ? `absolute top-2 right-2 z-10 p-2 rounded-full bg-background/80 backdrop-blur-sm shadow-sm transition-colors ${colorClasses}`
          : `flex items-center gap-1.5 p-2 rounded-full transition-colors ${colorClasses}`
      }
      title={favorited ? 'Remove favorite' : 'Favorite'}
      aria-pressed={favorited}
      disabled={toggleFavorite.isPending}
      onClick={(e) => {
        e.stopPropagation();
        toggleFavorite.mutate(eventId);
      }}
    >
      <Star className={`${overlay ? 'size-4' : 'size-5'} ${favorited ? 'fill-current' : ''}`} />
    </button>
  );
}
