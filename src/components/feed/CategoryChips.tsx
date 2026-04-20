import { cn } from '@/lib/utils';

export type Category = 'all' | 'animals' | 'music' | 'craft' | 'stories';

export const CATEGORY_LABELS: Record<Category, string> = {
  all:     'All',
  animals: 'Animals',
  music:   'Music',
  craft:   'Craft',
  stories: 'Stories',
};

/**
 * Horizontally-scrollable chip row used by the Home feed and Uploader.
 *
 * Visual only: exposes a controlled selected value. Parents pass the
 * ordered list they care about; Home uses `['all', …]`, Upload omits
 * `'all'`.
 */
export function CategoryChips({
  value,
  options,
  onChange,
  className,
}: {
  value: Category;
  options: Category[];
  onChange: (c: Category) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 overflow-x-auto no-scrollbar -mx-4 px-4',
        className,
      )}
      role="tablist"
    >
      {options.map((c) => {
        const active = value === c;
        return (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(c)}
            className={cn(
              'h-8 px-3 rounded-full text-[12px] font-medium whitespace-nowrap transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              active
                ? 'bg-primary text-primary-foreground'
                : 'bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            {CATEGORY_LABELS[c]}
          </button>
        );
      })}
    </div>
  );
}
