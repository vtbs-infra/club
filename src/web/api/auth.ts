import type { AccountRole } from '../../shared/contracts/common';
import type { Identity } from '../../shared/contracts/creators';
import { apiRequest } from './http';

export type { AccountRole, Identity };

export function getIdentity(): Promise<Identity> {
  return apiRequest('/api/v1/me');
}

export function signIn(email: string, password: string): Promise<unknown> {
  return apiRequest('/api/auth/sign-in/email', {
    body: JSON.stringify({ email, password }),
    method: 'POST',
  });
}

export function registerAccount(email: string, name: string, password: string): Promise<unknown> {
  return apiRequest('/api/auth/sign-up/email', {
    body: JSON.stringify({ email, name, password }),
    method: 'POST',
  });
}

export function signOut(): Promise<unknown> {
  return apiRequest('/api/auth/sign-out', { method: 'POST' });
}
