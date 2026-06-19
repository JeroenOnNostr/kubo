import { AlertsSection } from '@/components/AlertsSection';

/**
 * /parent/alerts — legacy standalone alerts inbox.
 *
 * KUBO-185 folded the alerts list into the per-kid Home dashboard and removed
 * the Alerts bottom-nav tab, so this route is now only reachable as a redirect
 * target / deep link. All the actual rendering + Approve/Deny logic lives in
 * the shared <AlertsSection /> (also mounted under Home), so the two views
 * can't drift. AppRouter redirects /parent/alerts → /parent/home, so this page
 * is effectively dead but kept importable for forward-compat.
 */
export function ParentAlertsPage() {
  return (
    <div className="flex flex-col gap-3 px-4 pt-2 pb-6">
      <AlertsSection variant="page" />
    </div>
  );
}
