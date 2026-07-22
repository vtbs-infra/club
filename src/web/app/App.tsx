import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';

import { FoundationPage } from '../pages/FoundationPage';

const queryClient = new QueryClient();
const router = createBrowserRouter([{ path: '*', element: <FoundationPage /> }]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
