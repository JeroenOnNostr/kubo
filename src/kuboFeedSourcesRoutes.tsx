import { Route } from 'react-router-dom';

import { ParentFeedPreviewPage } from '@/pages/ParentFeedPreviewPage';
import { CommunitiesSourcePage } from '@/pages/feed-sources/CommunitiesSourcePage';
import { PacksSourcePage } from '@/pages/feed-sources/PacksSourcePage';
import { ProfilesSourcePage } from '@/pages/feed-sources/ProfilesSourcePage';
import { RelaysSourcePage } from '@/pages/feed-sources/RelaysSourcePage';
import { YouTubeSourcePage } from '@/pages/feed-sources/YouTubeSourcePage';

/**
 * Route fragment for the /parent/feed/* subtree. Imported once inside the
 * KuboParentLayout <Route> block in AppRouter.tsx so additions here don't
 * diff that Ditto-owned file on every iteration (plan mitigation: minimize
 * upstream-merge churn).
 *
 * IMPORTANT: In AppRouter.tsx, render this as `{renderKuboFeedSourcesRoutes()}`
 * — NOT `<KuboFeedSourcesRoutes />`. React Router v6's <Routes> walks
 * children structurally; a wrapping component would hide the <Route>
 * elements from its traversal. Calling the function inline keeps the
 * fragment transparent to <Routes>.
 */
export function renderKuboFeedSourcesRoutes() {
  return (
    <>
      <Route path="/parent/feed/preview"     element={<ParentFeedPreviewPage   />} />
      <Route path="/parent/feed/relays"      element={<RelaysSourcePage        />} />
      <Route path="/parent/feed/communities" element={<CommunitiesSourcePage   />} />
      <Route path="/parent/feed/packs"       element={<PacksSourcePage         />} />
      <Route path="/parent/feed/profiles"    element={<ProfilesSourcePage      />} />
      <Route path="/parent/feed/youtube"     element={<YouTubeSourcePage       />} />
    </>
  );
}
