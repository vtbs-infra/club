import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { Link, RouterProvider, createBrowserRouter } from 'react-router-dom';

import { ProtectedLayout, RoleLanding } from '../components/AppShell';
import { LoadingState } from '../components/Ui';
import { AuthPage } from '../pages/AuthPage';
import { HomePage } from '../pages/HomePage';

const AccountPage = lazy(() =>
  import('../pages/AccountPages').then((module) => ({ default: module.AccountPage })),
);
const AddressesAccountPage = lazy(() =>
  import('../pages/AccountPages').then((module) => ({ default: module.AddressesAccountPage })),
);
const BilibiliAccountPage = lazy(() =>
  import('../pages/AccountPages').then((module) => ({ default: module.BilibiliAccountPage })),
);
const AnnouncementsPage = lazy(() =>
  import('../pages/AnnouncementsPage').then((module) => ({
    default: module.AnnouncementsPage,
  })),
);
const DashboardPage = lazy(() =>
  import('../pages/DashboardPage').then((module) => ({ default: module.DashboardPage })),
);
const GiftDetailPage = lazy(() =>
  import('../pages/GiftDetailPage').then((module) => ({ default: module.GiftDetailPage })),
);
const GiftsPage = lazy(() =>
  import('../pages/GiftsPage').then((module) => ({ default: module.GiftsPage })),
);
const AdminAnnouncementsPage = lazy(() =>
  import('../pages/admin/AdminAuxPages').then((module) => ({
    default: module.AdminAnnouncementsPage,
  })),
);
const AdminSystemPage = lazy(() =>
  import('../pages/admin/AdminAuxPages').then((module) => ({
    default: module.AdminSystemPage,
  })),
);
const AdminCreatorsPage = lazy(() =>
  import('../pages/admin/AdminCreatorsPage').then((module) => ({
    default: module.AdminCreatorsPage,
  })),
);
const AdminOverviewPage = lazy(() =>
  import('../pages/admin/AdminOverviewPage').then((module) => ({
    default: module.AdminOverviewPage,
  })),
);
const AdminRostersPage = lazy(() =>
  import('../pages/admin/AdminRostersPage').then((module) => ({
    default: module.AdminRostersPage,
  })),
);
const AdminVerificationPage = lazy(() =>
  import('../pages/admin/AdminVerificationPage').then((module) => ({
    default: module.AdminVerificationPage,
  })),
);
const CreatorAnnouncementsPage = lazy(() =>
  import('../pages/creator/CreatorAuxPages').then((module) => ({
    default: module.CreatorAnnouncementsPage,
  })),
);
const CreatorSettingsPage = lazy(() =>
  import('../pages/creator/CreatorAuxPages').then((module) => ({
    default: module.CreatorSettingsPage,
  })),
);
const CreatorOrderDetailPage = lazy(() =>
  import('../pages/creator/CreatorOrderDetailPage').then((module) => ({
    default: module.CreatorOrderDetailPage,
  })),
);
const CreatorOrdersPage = lazy(() =>
  import('../pages/creator/CreatorOrdersPage').then((module) => ({
    default: module.CreatorOrdersPage,
  })),
);
const CreatorOverviewPage = lazy(() =>
  import('../pages/creator/CreatorOverviewPage').then((module) => ({
    default: module.CreatorOverviewPage,
  })),
);
const CreatorReleasesPage = lazy(() =>
  import('../pages/creator/CreatorReleasesPage').then((module) => ({
    default: module.CreatorReleasesPage,
  })),
);
const ReleaseEditorPage = lazy(() =>
  import('../pages/creator/ReleaseEditorPage').then((module) => ({
    default: module.ReleaseEditorPage,
  })),
);

function NotFoundPage() {
  return (
    <main className="not-found">
      <span>404</span>
      <h1>这里没有你要找的页面</h1>
      <p>请检查访问地址，或返回首页继续使用 Club。</p>
      <Link className="button primary" to="/">
        返回首页
      </Link>
    </main>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 15_000 },
  },
});

const router = createBrowserRouter([
  { element: <HomePage />, path: '/' },
  { element: <AuthPage mode="login" />, path: '/login' },
  { element: <AuthPage mode="register" />, path: '/register' },
  { element: <RoleLanding />, path: '/app' },
  {
    element: <ProtectedLayout area="user" />,
    children: [
      { element: <DashboardPage />, path: '/dashboard' },
      { element: <GiftsPage />, path: '/gifts' },
      { element: <GiftDetailPage />, path: '/gifts/:giftOrderId' },
      { element: <AnnouncementsPage />, path: '/announcements' },
      { element: <AccountPage />, path: '/account' },
      { element: <BilibiliAccountPage />, path: '/account/bilibili' },
      { element: <AddressesAccountPage />, path: '/account/addresses' },
    ],
  },
  {
    element: <ProtectedLayout area="creator" />,
    children: [
      { element: <CreatorOverviewPage />, path: '/creator' },
      { element: <CreatorReleasesPage />, path: '/creator/releases' },
      { element: <ReleaseEditorPage />, path: '/creator/releases/new' },
      { element: <ReleaseEditorPage />, path: '/creator/releases/:releaseId' },
      { element: <CreatorOrdersPage />, path: '/creator/orders' },
      { element: <CreatorOrderDetailPage />, path: '/creator/orders/:giftOrderId' },
      { element: <CreatorAnnouncementsPage />, path: '/creator/announcements' },
      { element: <CreatorSettingsPage />, path: '/creator/settings' },
    ],
  },
  {
    element: <ProtectedLayout area="admin" />,
    children: [
      { element: <AdminOverviewPage />, path: '/admin' },
      { element: <AdminCreatorsPage />, path: '/admin/creators' },
      { element: <AdminRostersPage />, path: '/admin/rosters' },
      { element: <AdminVerificationPage />, path: '/admin/verification' },
      { element: <AdminAnnouncementsPage />, path: '/admin/announcements' },
      { element: <AdminSystemPage />, path: '/admin/system' },
    ],
  },
  { element: <NotFoundPage />, path: '*' },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Suspense
        fallback={
          <main className="centered-state">
            <LoadingState label="正在打开页面…" />
          </main>
        }
      >
        <RouterProvider router={router} />
      </Suspense>
    </QueryClientProvider>
  );
}
