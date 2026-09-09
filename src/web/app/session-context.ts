import { createContext, useContext } from 'react';

import type { Identity } from '../api/auth';

export const SessionContext = createContext<{
  readonly acceptIdentity: (identity: Identity) => void;
  readonly endSession: () => void;
} | null>(null);

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('Session provider is missing.');
  return session;
}
