import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, RouterProvider, createBrowserRouter } from 'react-router-dom';

import { ProtectedLayout, RoleLanding } from '../components/AppShell';
import { AccountPage, AddressesAccountPage, BilibiliAccountPage } from '../pages/AccountPages';
import { AnnouncementsPage } from '../pages/AnnouncementsPage';
import { AuthPage } from '../pages/AuthPage';
import { DashboardPage } from '../pages/DashboardPage';
import { GiftDetailPage } from '../pages/GiftDetailPage';
import { GiftsPage } from '../pages/GiftsPage';
import { HomePage } from '../pages/HomePage';
import { AdminAnnouncementsPage, AdminSystemPage } from '../pages/admin/AdminAuxPages';
import { AdminCreatorsPage } from '../pages/admin/AdminCreatorsPage';
import { AdminOverviewPage } from '../pages/admin/AdminOverviewPage';
import { AdminRostersPage } from '../pages/admin/AdminRostersPage';
import { AdminVerificationPage } from '../pages/admin/AdminVerificationPage';
import { CreatorAnnouncementsPage, CreatorSettingsPage } from '../pages/creator/CreatorAuxPages';
import { CreatorOrderDetailPage } from '../pages/creator/CreatorOrderDetailPage';
import { CreatorOrdersPage } from '../pages/creator/CreatorOrdersPage';
import { CreatorOverviewPage } from '../pages/creator/CreatorOverviewPage';
import { CreatorReleasesPage } from '../pages/creator/CreatorReleasesPage';
import { ReleaseEditorPage } from '../pages/creator/ReleaseEditorPage';

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
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
