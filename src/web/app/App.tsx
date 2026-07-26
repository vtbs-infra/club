import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';

import { AccountPage } from '../pages/AccountPage';
import { AuthPage } from '../pages/AuthPage';
import { CampaignsPage } from '../pages/CampaignsPage';
import { ClaimDetailPage } from '../pages/ClaimDetailPage';
import { ClaimsPage } from '../pages/ClaimsPage';
import { FoundationPage } from '../pages/FoundationPage';
import { FulfillmentPage } from '../pages/FulfillmentPage';
import { GiftDetailPage } from '../pages/GiftDetailPage';
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
  { element: <GiftDetailPage />, path: '/gifts/:campaignId' },
  { element: <ClaimsPage />, path: '/claims' },
  { element: <ClaimDetailPage />, path: '/claims/:claimId' },
  { element: <OrganizationsPage />, path: '/organizations' },
  { element: <OrganizationPage />, path: '/organizations/:organizationId' },
  { element: <CampaignsPage />, path: '/organizations/:organizationId/campaigns' },
  { element: <FulfillmentPage />, path: '/organizations/:organizationId/fulfillment' },
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
