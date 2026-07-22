import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

import { getIdentity, type Identity } from '../api/identity';
import { ApiError } from '../api/http';
import { SiteHeader } from './SiteHeader';

interface AuthenticatedPageProperties {
  readonly children: (identity: Identity) => ReactNode;
}

export function AuthenticatedPage({ children }: AuthenticatedPageProperties) {
  const identity = useQuery({ queryFn: getIdentity, queryKey: ['identity'], retry: false });

  if (identity.error instanceof ApiError && identity.error.status === 401) {
    return <Navigate replace to="/login" />;
  }
  return (
    <main className="shell">
      <SiteHeader authenticated />
      {identity.isPending ? <div className="page-state">Loading your account…</div> : null}
      {identity.isError &&
      !(identity.error instanceof ApiError && identity.error.status === 401) ? (
        <div className="page-state page-error">Your account could not be loaded.</div>
      ) : null}
      {identity.data ? children(identity.data) : null}
    </main>
  );
}
