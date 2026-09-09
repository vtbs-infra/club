import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import type { Identity } from '../api/auth';
import { appearanceQueryKey, type Appearance } from '../api/appearance';
import { ApiError } from '../api/http';
import { SessionContext } from './session-context';

function identityKey(identity: Identity): string {
  return `${identity.user.id}:${identity.user.role}:${identity.creator?.id ?? ''}`;
}

function createSessionClient(
  identity: Identity | undefined,
  change: (source: QueryClient, identity: Identity | undefined) => void,
): QueryClient {
  const owner = identity ? identityKey(identity) : null;
  const onError = (error: Error) => {
    if (owner && error instanceof ApiError && error.status === 401) change(client, undefined);
  };
  const client = new QueryClient({
    defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 15_000 } },
    queryCache: new QueryCache({
      onError,
      onSuccess(data, query) {
        if (query.queryKey[0] !== 'identity') return;
        const next = data as Identity;
        if (identityKey(next) !== owner) change(client, next);
      },
    }),
    mutationCache: new MutationCache({ onError }),
  });
  if (identity) client.setQueryData(['identity'], identity);
  return client;
}

/** A retired account keeps neither UI state nor a cache shared with its successor. */
export function SessionQueryProvider({ children }: { readonly children: ReactNode }) {
  const [session, setSession] = useState(() => ({
    client: createSessionClient(undefined, change),
    generation: 0,
  }));

  function change(source: QueryClient, identity: Identity | undefined) {
    const next = createSessionClient(identity, change);
    const appearance = source.getQueryData<Appearance>(appearanceQueryKey);
    if (appearance) next.setQueryData(appearanceQueryKey, appearance);
    void source.cancelQueries();
    source.clear();
    setSession((current) =>
      current.client === source ? { client: next, generation: current.generation + 1 } : current,
    );
  }

  return (
    <SessionContext.Provider
      value={{
        acceptIdentity: (identity) => change(session.client, identity),
        endSession: () => change(session.client, undefined),
      }}
    >
      <QueryClientProvider client={session.client} key={session.generation}>
        {children}
      </QueryClientProvider>
    </SessionContext.Provider>
  );
}
