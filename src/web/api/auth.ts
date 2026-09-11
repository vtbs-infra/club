import type { AccountRole } from '../../shared/contracts/common';
import type { Identity } from '../../shared/contracts/creators';
import type {
  AuthUser,
  CreateChallengeBody,
  IdentityChallenge,
  SessionState,
} from '../../shared/contracts/auth';
import { apiRequest } from './http';
export type { AccountRole, Identity, IdentityChallenge };
export function getIdentity(): Promise<Identity> {
  return apiRequest('/api/v1/me');
}
export function signIn(username: string, password: string): Promise<SessionState> {
  return apiRequest('/api/v1/auth/login', {
    body: JSON.stringify({ username, password }),
    method: 'POST',
  });
}
export function createIdentityChallenge(input: CreateChallengeBody): Promise<IdentityChallenge> {
  return apiRequest('/api/v1/auth/challenges', { body: JSON.stringify(input), method: 'POST' });
}
export function getIdentityChallenge(id: string): Promise<IdentityChallenge> {
  return apiRequest('/api/v1/auth/challenges/' + id);
}
export function registerAccount(input: {
  challengeId: string;
  username: string;
  name: string;
  password: string;
}): Promise<AuthUser> {
  return apiRequest('/api/v1/auth/register', { body: JSON.stringify(input), method: 'POST' });
}
export function recoverAccount(challengeId: string, password: string): Promise<void> {
  return apiRequest('/api/v1/auth/recover', {
    body: JSON.stringify({ challengeId, password }),
    method: 'POST',
  });
}
export function changePassword(currentPassword: string, password: string): Promise<void> {
  return apiRequest('/api/v1/auth/password', {
    body: JSON.stringify({ currentPassword, password }),
    method: 'POST',
  });
}
export function updateProfile(name: string): Promise<AuthUser> {
  return apiRequest('/api/v1/me/profile', { body: JSON.stringify({ name }), method: 'PATCH' });
}
export function signOut(): Promise<void> {
  return apiRequest('/api/v1/auth/logout', { method: 'POST' });
}
