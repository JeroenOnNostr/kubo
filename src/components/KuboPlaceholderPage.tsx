import { Construction } from 'lucide-react';

interface KuboPlaceholderPageProps {
  title: string;
  /** Which upcoming PR will implement this page. Shown in the body copy. */
  pr?: number;
  /** Optional extra copy describing what will go here. */
  description?: string;
}

/**
 * Stub page rendered by every Kubo route registered in PR 1 that doesn't
 * yet have real content. Gives a honest "coming soon" signal while still
 * exercising the route/layout/nav integration.
 *
 * Delete callers of this as each subsequent PR lands its real page.
 */
export function KuboPlaceholderPage({ title, pr, description }: KuboPlaceholderPageProps) {
  return (
    <div className="min-h-dvh flex items-center justify-center px-6">
      <div className="flex flex-col items-center gap-4 max-w-sm text-center">
        <div className="size-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
          <Construction className="size-7" />
        </div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">
          {description ?? 'This screen is part of the Kubo rebuild and will be implemented in an upcoming PR.'}
          {pr !== undefined && <> Coming in PR&nbsp;{pr}.</>}
        </p>
      </div>
    </div>
  );
}
