import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';

import { AccountPage } from '../pages/AccountPage';
import { AuthPage } from '../pages/AuthPage';
import { FoundationPage } from '../pages/FoundationPage';
import { OrganizationPage } from '../pages/OrganizationPage';
import { OrganizationsPage } from '../pages/OrganizationsPage';
import { SnapshotsPage } from '../pages/SnapshotsPage';
import { VerificationRoomsPage } from '../pages/VerificationRoomsPage';

const queryClient = new QueryClient();
const router = createBrowserRouter([
  { element: <FoundationPage />, path: '/' },
  { element: <AuthPage mode="login" />, path: '/login' },
  { element: <AuthPage mode="register" />, path: '/register' },
  { element: <AccountPage />, path: '/account' },
  { element: <OrganizationsPage />, path: '/organizations' },
  { element: <OrganizationPage />, path: '/organizations/:organizationId' },
  {
    element: <SnapshotsPage />,
    path: '/organizations/:organizationId/creators/:creatorId/snapshots',
  },
  { element: <VerificationRoomsPage />, path: '/platform/verification-rooms' },
  { element: <FoundationPage />, path: '*' },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
