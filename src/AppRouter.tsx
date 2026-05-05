import { lazy, Suspense, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AudioNavigationGuard } from "@/components/AudioNavigationGuard";
import { DeepLinkHandler } from "@/components/DeepLinkHandler";
import { MinimizedAudioBar } from "@/components/MinimizedAudioBar";
import { AudioPlayerProvider } from "@/contexts/AudioPlayerContext";
import { BlobbiActionsProvider } from "@/blobbi/companion/interaction/BlobbiActionsProvider";
import { sidebarItemIcon } from "@/lib/sidebarItems";
import { Toaster } from "./components/ui/toaster";
import { MainLayout } from "./components/MainLayout";
import { ScrollToTop } from "./components/ScrollToTop";
import { VersionCheck } from "./components/VersionCheck";
import { useCurrentUser } from "./hooks/useCurrentUser";
import { useFeedSettings } from "./hooks/useFeedSettings";
import { useProfileUrl } from "./hooks/useProfileUrl";
import { getExtraKindDef } from "./lib/extraKinds";

// Critical-path pages: eagerly loaded (landing + fallback)
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

// Lazy-loaded companion layer (~450K code-split)
const BlobbiCompanionLayer = lazy(() => import("@/blobbi/companion").then(m => ({ default: m.BlobbiCompanionLayer })));

/** Mount the Blobbi companion only when feedSettings.showBlobbi is true. */
function GatedBlobbiCompanionLayer() {
  const { feedSettings } = useFeedSettings();
  if (!feedSettings.showBlobbi) return null;
  return (
    <Suspense fallback={null}>
      <BlobbiCompanionLayer />
    </Suspense>
  );
}

// Lazy-loaded compose modal (pulls in emoji-mart ~620K)
const ReplyComposeModal = lazy(() => import("@/components/ReplyComposeModal").then(m => ({ default: m.ReplyComposeModal })));

// Lazy-loaded emoji pack dialog
const EmojiPackDialog = lazy(() => import("@/components/EmojiPackDialog").then(m => ({ default: m.EmojiPackDialog })));

// Kubo chrome + boot gate (PR 1)
import { KuboBootGate } from "@/components/KuboBootGate";
import { KuboParentLayout } from "@/components/KuboParentLayout";
import { KuboPlaceholderPage } from "@/components/KuboPlaceholderPage";
import { KuboOnboardLayout } from "@/components/KuboOnboardLayout";
import { WelcomePage } from "@/pages/WelcomePage";
import { CreateParentAccountPage } from "@/pages/CreateParentAccountPage";
import { ParentLoginPage } from "@/pages/ParentLoginPage";
import { AddKidPage } from "@/pages/AddKidPage";
import { KidDashboardPage } from "@/pages/KidDashboardPage";
import { KidWatchHistoryPage } from "@/pages/KidWatchHistoryPage";
import { KidKeysPage } from "@/pages/KidKeysPage";
import { EditKidSettingsPage } from "@/pages/EditKidSettingsPage";
import { EditKidFeedSettingsPage } from "@/pages/EditKidFeedSettingsPage";
import { TrustPeoplePage } from "@/pages/TrustPeoplePage";
import { TrustPlacesPage } from "@/pages/TrustPlacesPage";
import { ParentTrustIndexPage } from "@/pages/ParentTrustIndexPage";
import { ParentAlertsPage } from "@/pages/ParentAlertsPage";
import { ParentFeedPage } from "@/pages/ParentFeedPage";
import { renderKuboFeedSourcesRoutes } from "@/kuboFeedSourcesRoutes";
import { VideoViewPage } from "@/pages/VideoViewPage";
import { ProfileViewPage } from "@/pages/ProfileViewPage";
import { ContentUploaderPage } from "@/pages/ContentUploaderPage";
import { GroupViewPage } from "@/pages/GroupViewPage";
import { WoTScorePage } from "@/pages/WoTScorePage";
import { KuboKidLayout } from "@/components/KuboKidLayout";
import { renderKuboKidRoutes } from "@/kuboKidRoutes";

// All other pages: code-split via React.lazy
const AdvancedSettingsPage = lazy(() => import("./pages/AdvancedSettingsPage").then(m => ({ default: m.AdvancedSettingsPage })));
const AIChatPage = lazy(() => import("./pages/AIChatPage").then(m => ({ default: m.AIChatPage })));
const ArchivePage = lazy(() => import("./pages/ArchivePage").then(m => ({ default: m.ArchivePage })));
const ArticleEditorPage = lazy(() => import("./pages/ArticleEditorPage").then(m => ({ default: m.ArticleEditorPage })));
const BadgesPage = lazy(() => import("./pages/BadgesPage").then(m => ({ default: m.BadgesPage })));
const BlobbiPage = lazy(() => import("./pages/BlobbiPage").then(m => ({ default: m.BlobbiPage })));
const BlueskyPage = lazy(() => import("./pages/BlueskyPage").then(m => ({ default: m.BlueskyPage })));
const BookmarksPage = lazy(() => import("./pages/BookmarksPage").then(m => ({ default: m.BookmarksPage })));
const BooksPage = lazy(() => import("./pages/BooksPage").then(m => ({ default: m.BooksPage })));
const ChangelogPage = lazy(() => import("./pages/ChangelogPage").then(m => ({ default: m.ChangelogPage })));
const ContentPage = lazy(() => import("./pages/ContentPage").then(m => ({ default: m.ContentPage })));
const ContentSettingsPage = lazy(() => import("./pages/ContentSettingsPage").then(m => ({ default: m.ContentSettingsPage })));
const CSAEPolicyPage = lazy(() => import("./pages/CSAEPolicyPage").then(m => ({ default: m.CSAEPolicyPage })));
const DomainFeedPage = lazy(() => import("./pages/DomainFeedPage").then(m => ({ default: m.DomainFeedPage })));
const EventsFeedPage = lazy(() => import("./pages/EventsFeedPage").then(m => ({ default: m.EventsFeedPage })));
const ExternalContentPage = lazy(() => import("./pages/ExternalContentPage").then(m => ({ default: m.ExternalContentPage })));
const GeotagPage = lazy(() => import("./pages/GeotagPage").then(m => ({ default: m.GeotagPage })));
const HashtagPage = lazy(() => import("./pages/HashtagPage").then(m => ({ default: m.HashtagPage })));
const HelpPage = lazy(() => import("./pages/HelpPage").then(m => ({ default: m.HelpPage })));
const KindFeedPage = lazy(() => import("./pages/KindFeedPage").then(m => ({ default: m.KindFeedPage })));
const LetterComposePage = lazy(() => import("./pages/LetterComposePage").then(m => ({ default: m.LetterComposePage })));
const LetterPreferencesPage = lazy(() => import("./pages/LetterPreferencesPage").then(m => ({ default: m.LetterPreferencesPage })));
const LettersPage = lazy(() => import("./pages/LettersPage").then(m => ({ default: m.LettersPage })));
const MagicSettingsPage = lazy(() => import("./pages/MagicSettingsPage").then(m => ({ default: m.MagicSettingsPage })));
const HiddenFeaturesSettingsPage = lazy(() => import("./pages/HiddenFeaturesSettingsPage").then(m => ({ default: m.HiddenFeaturesSettingsPage })));
const MusicPage = lazy(() => import("./pages/MusicPage").then(m => ({ default: m.MusicPage })));
const NetworkSettingsPage = lazy(() => import("./pages/NetworkSettingsPage").then(m => ({ default: m.NetworkSettingsPage })));
const NIP19Page = lazy(() => import("./pages/NIP19Page").then(m => ({ default: m.NIP19Page })));
const NotificationSettings = lazy(() => import("./pages/NotificationSettings").then(m => ({ default: m.NotificationSettings })));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage").then(m => ({ default: m.NotificationsPage })));
const PhotosFeedPage = lazy(() => import("./pages/PhotosFeedPage").then(m => ({ default: m.PhotosFeedPage })));
const PodcastsFeedPage = lazy(() => import("./pages/PodcastsFeedPage").then(m => ({ default: m.PodcastsFeedPage })));
const PrivacyPolicyPage = lazy(() => import("./pages/PrivacyPolicyPage").then(m => ({ default: m.PrivacyPolicyPage })));
const ProfileSettings = lazy(() => import("./pages/ProfileSettings").then(m => ({ default: m.ProfileSettings })));
const RelayPage = lazy(() => import("./pages/RelayPage").then(m => ({ default: m.RelayPage })));
const SearchPage = lazy(() => import("./pages/SearchPage").then(m => ({ default: m.SearchPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then(m => ({ default: m.SettingsPage })));
const ThemesPage = lazy(() => import("./pages/ThemesPage").then(m => ({ default: m.ThemesPage })));
const TreasuresPage = lazy(() => import("./pages/TreasuresPage").then(m => ({ default: m.TreasuresPage })));
const TrendsPage = lazy(() => import("./pages/TrendsPage").then(m => ({ default: m.TrendsPage })));
const UserListsPage = lazy(() => import("./pages/UserListsPage").then(m => ({ default: m.UserListsPage })));
const VideosFeedPage = lazy(() => import("./pages/VideosFeedPage").then(m => ({ default: m.VideosFeedPage })));
const VinesFeedPage = lazy(() => import("./pages/VinesFeedPage").then(m => ({ default: m.VinesFeedPage })));
const WalletSettingsPage = lazy(() => import("./pages/WalletSettingsPage").then(m => ({ default: m.WalletSettingsPage })));
const WebxdcFeedPage = lazy(() => import("./pages/WebxdcFeedPage").then(m => ({ default: m.WebxdcFeedPage })));
const WikipediaPage = lazy(() => import("./pages/WikipediaPage").then(m => ({ default: m.WikipediaPage })));
const WorldPage = lazy(() => import("./pages/WorldPage").then(m => ({ default: m.WorldPage })));
const FollowPage = lazy(() => import("./pages/FollowPage").then(m => ({ default: m.FollowPage })));
const RemoteLoginSuccessPage = lazy(() => import("./pages/RemoteLoginSuccessPage").then(m => ({ default: m.RemoteLoginSuccessPage })));

const pollsDef = getExtraKindDef("polls")!;
const colorsDef = getExtraKindDef("colors")!;
const packsDef = getExtraKindDef("packs")!;
const articlesDef = getExtraKindDef("articles")!;
const decksDef = getExtraKindDef("decks")!;
const emojisDef = getExtraKindDef("emojis")!;
const developmentDef = getExtraKindDef("development")!;

/** Polls feed page with a FAB that opens the compose modal (poll mode via + menu). */
function PollsFeedPage() {
  const [composeOpen, setComposeOpen] = useState(false);
  return (
    <>
      <KindFeedPage
        kind={pollsDef.kind}
        title={pollsDef.label}
        icon={sidebarItemIcon("polls", "size-5")}
        onFabClick={() => setComposeOpen(true)}
      />
      {composeOpen && (
        <Suspense fallback={null}>
          <ReplyComposeModal open={composeOpen} onOpenChange={setComposeOpen} initialMode="poll" />
        </Suspense>
      )}
    </>
  );
}

/** Emoji feed page with a FAB that opens the emoji pack creation dialog. */
function EmojiFeedPage() {
  const [composeOpen, setComposeOpen] = useState(false);
  return (
    <>
      <KindFeedPage
        kind={emojisDef.kind}
        title={emojisDef.label}
        icon={sidebarItemIcon("emojis", "size-5")}
        onFabClick={() => setComposeOpen(true)}
      />
      {composeOpen && (
        <Suspense fallback={null}>
          <EmojiPackDialog open={composeOpen} onOpenChange={setComposeOpen} />
        </Suspense>
      )}
    </>
  );
}

/** Redirects /profile to the user's canonical profile URL (nip05 or npub). */
function ProfileRedirect() {
  const { user, metadata } = useCurrentUser();
  const profileUrl = useProfileUrl(user?.pubkey ?? "", metadata);
  if (!user) return <Navigate to="/" replace />;
  return <Navigate to={profileUrl} replace />;
}

export function AppRouter() {
  return (
    <AudioPlayerProvider>
      <BrowserRouter>
        <Toaster />
        <VersionCheck />
        <MinimizedAudioBar />
        <AudioNavigationGuard />
        <DeepLinkHandler />
        <ScrollToTop />
        <BlobbiActionsProvider>
          <GatedBlobbiCompanionLayer />
        </BlobbiActionsProvider>
        <Routes>
          {/* Auto-follow deep link: fullscreen immersive (no sidebars/nav) */}
          <Route path="/follow/:npub" element={<FollowPage />} />

          {/* All routes share the persistent MainLayout (sidebar + nav) */}
          <Route element={<MainLayout />}>
            <Route path="/" element={<KuboBootGate />} />
            <Route path="/feed" element={<Index />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/trends" element={<TrendsPage />} />
            <Route path="/profile" element={<ProfileRedirect />} />
             <Route path="/t/:tag" element={<HashtagPage />} />
             <Route path="/g/:geohash" element={<GeotagPage />} />
            <Route path="/feed/:domain" element={<DomainFeedPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/profile" element={<ProfileSettings />} />
            <Route path="/settings/feed" element={<ContentSettingsPage />} />
            <Route path="/settings/content" element={<ContentPage />} />
            <Route path="/settings/wallet" element={<WalletSettingsPage />} />
            <Route
              path="/settings/notifications"
              element={<NotificationSettings />}
            />
            <Route
              path="/settings/advanced"
              element={<AdvancedSettingsPage />}
            />
            <Route path="/settings/magic" element={<MagicSettingsPage />} />
            <Route path="/settings/hidden-features" element={<HiddenFeaturesSettingsPage />} />
            <Route path="/settings/network" element={<NetworkSettingsPage />} />
            <Route path="/lists" element={<UserListsPage />} />
            <Route path="/events" element={<EventsFeedPage />} />
            <Route path="/photos" element={<PhotosFeedPage />} />
            <Route path="/videos" element={<VideosFeedPage />} />
            {/* /streams redirects to /videos for backward compatibility */}
            <Route
              path="/streams"
              element={<Navigate to="/videos" replace />}
            />
            <Route path="/vines" element={<VinesFeedPage />} />
            <Route path="/music" element={<MusicPage />} />
            <Route path="/podcasts" element={<PodcastsFeedPage />} />
            <Route path="/polls" element={<PollsFeedPage />} />
            <Route path="/treasures" element={<TreasuresPage />} />
            <Route
              path="/colors"
              element={
                <KindFeedPage
                  kind={colorsDef.kind}
                  title={colorsDef.label}
                  icon={sidebarItemIcon("colors", "size-5")}
                />
              }
            />
            <Route
              path="/packs"
              element={
                <KindFeedPage
                  kind={packsDef.kind}
                  title={packsDef.label}
                  icon={sidebarItemIcon("packs", "size-5")}
                />
              }
            />
            <Route path="/webxdc" element={<WebxdcFeedPage />} />
            <Route path="/articles/new" element={<ArticleEditorPage />} />
            <Route path="/articles/edit/:naddr" element={<ArticleEditorPage />} />
            <Route
              path="/articles"
              element={
                <KindFeedPage
                  kind={articlesDef.kind}
                  title={articlesDef.label}
                  icon={sidebarItemIcon("articles", "size-5")}
                  fabHref="/articles/new"
                />
              }
            />
            <Route
              path="/decks"
              element={
                <KindFeedPage
                  kind={decksDef.kind}
                  title={decksDef.label}
                  icon={sidebarItemIcon("decks", "size-5")}
                />
              }
            />
            <Route path="/emojis" element={<EmojiFeedPage />} />
            <Route
              path="/development"
              element={
                <KindFeedPage
                  kind={[
                    developmentDef.kind,
                    ...(developmentDef.extraFeedKinds ?? []),
                  ]}
                  title={developmentDef.label}
                  icon={sidebarItemIcon("development", "size-5")}
                  showFAB={false}
                />
              }
            />
            <Route path="/themes" element={<ThemesPage />} />
            <Route path="/bookmarks" element={<BookmarksPage />} />
            <Route path="/ai-chat" element={<AIChatPage />} />
            <Route path="/blobbi" element={<BlobbiPage />} />
            <Route path="/world" element={<WorldPage />} />
            <Route path="/badges" element={<BadgesPage />} />
            <Route path="/books" element={<BooksPage />} />
            <Route path="/archive" element={<ArchivePage />} />
            <Route path="/bluesky" element={<BlueskyPage />} />
            <Route path="/wikipedia" element={<WikipediaPage />} />
            <Route path="/letters" element={<LettersPage />} />
            <Route path="/letters/compose" element={<LetterComposePage />} />
            <Route path="/settings/letters" element={<LetterPreferencesPage />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="/privacy" element={<PrivacyPolicyPage />} />
            <Route path="/safety" element={<CSAEPolicyPage />} />
            <Route path="/changelog" element={<ChangelogPage />} />
            <Route path="/r/*" element={<RelayPage />} />
            <Route
              path="/settings/lists"
              element={<Navigate to="/lists" replace />}
            />
            <Route path="/i/*" element={<ExternalContentPage />} />

            {/* Callback target for remote signers (e.g. Amber, Primal) after NIP-46 approval */}
            <Route path="/remoteloginsuccess" element={<RemoteLoginSuccessPage />} />
            {/* NIP-19 route for npub1, note1, naddr1, nevent1, nprofile1 */}
            <Route path="/:nip19" element={<NIP19Page />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Route>

          {/* ─── Kubo parent app ──────────────────────────────────────────── */}
          {/* All kid-scoped pages derive their kid from the active Nostr
              signer (logins[0]) via useSelectedKid — the top-right gear
              dropdown on the Feed tab swaps signers. No :id params. */}
          <Route element={<KuboParentLayout />}>
            <Route path="/parent"               element={<Navigate to="/parent/home" replace />} />
            <Route path="/parent/home"          element={<KidDashboardPage    />} />
            <Route path="/parent/watch-history" element={<KidWatchHistoryPage />} />
            <Route path="/parent/feed"          element={<ParentFeedPage      />} />
            {renderKuboFeedSourcesRoutes()}
            <Route path="/parent/upload"        element={<ContentUploaderPage />} />
            <Route path="/parent/video/:id"     element={<VideoViewPage       />} />
            <Route path="/parent/profile/:npub" element={<ProfileViewPage     />} />
            <Route path="/parent/trust"         element={<ParentTrustIndexPage />} />
            <Route path="/parent/trust/people"  element={<TrustPeoplePage     />} />
            <Route path="/parent/trust/places"  element={<TrustPlacesPage     />} />
            <Route path="/parent/groups/:gid"   element={<GroupViewPage       />} />
            <Route path="/parent/alerts"        element={<ParentAlertsPage    />} />
            <Route path="/parent/kid-settings"  element={<EditKidSettingsPage />} />
            <Route path="/parent/feed-settings" element={<EditKidFeedSettingsPage />} />
            <Route path="/parent/keys"          element={<KidKeysPage         />} />
            <Route path="/parent/wot"           element={<WoTScorePage        />} />
          </Route>

          {/* ─── Kubo onboarding ─────────────────────────────── */}
          <Route element={<KuboOnboardLayout />}>
            <Route path="/onboard/welcome"       element={<WelcomePage />} />
            <Route path="/onboard/create-parent" element={<CreateParentAccountPage />} />
            <Route path="/onboard/login"         element={<ParentLoginPage />} />
            <Route path="/onboard/add-kid"       element={<AddKidPage />} />
          </Route>

          {/* ─── Kid app ──────────────────────────────────────────────────── */}
          <Route element={<KuboKidLayout />}>
            {renderKuboKidRoutes()}
          </Route>
        </Routes>
      </BrowserRouter>
    </AudioPlayerProvider>
  );
}
export default AppRouter;
