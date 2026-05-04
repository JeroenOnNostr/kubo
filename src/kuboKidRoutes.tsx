import { Route } from 'react-router-dom';

import { KidHomePage } from '@/pages/KidHomePage';
import { KidPostDetailPage } from '@/pages/kid/KidPostDetailPage';
import { KidProfileViewPage } from '@/pages/kid/KidProfileViewPage';
import { KuboKidBlobbiPage } from '@/components/KuboKidBlobbiPage';

/**
 * Route fragment for the /kid/* subtree. Imported once inside the
 * KuboKidLayout <Route> block in AppRouter.tsx so additions here don't
 * diff that Ditto-owned file on every iteration (plan mitigation: minimize
 * upstream-merge churn).
 *
 * IMPORTANT: In AppRouter.tsx, render this as `{renderKuboKidRoutes()}`
 * — NOT `<KuboKidRoutes />`. React Router v6's <Routes> walks children
 * structurally; a wrapping component would hide the <Route> elements from
 * its traversal. Calling the function inline keeps the fragment
 * transparent to <Routes>.
 */
export function renderKuboKidRoutes() {
  return (
    <>
      <Route path="/kid"               element={<KidHomePage         />} />
      <Route path="/kid/blobbi"        element={<KuboKidBlobbiPage   />} />
      <Route path="/kid/favorites"     element={<KidHomePage         />} />
      <Route path="/kid/profile/:npub" element={<KidProfileViewPage  />} />
      <Route path="/kid/post/:id"      element={<KidPostDetailPage   />} />
    </>
  );
}
