import { apiRequest } from './http';

export type OrganizationRole = 'OWNER' | 'ADMIN' | 'OPERATOR' | 'FULFILLMENT' | 'VIEWER';

export interface Identity {
  readonly memberships: readonly Membership[];
  readonly user: {
    readonly email: string;
    readonly id: string;
    readonly name: string;
    readonly platformRole: 'USER' | 'PLATFORM_ADMIN';
  };
}

export interface Membership {
  readonly creatorIds: readonly string[];
  readonly id: string;
  readonly organization: { readonly id: string; readonly name: string; readonly slug: string };
  readonly role: OrganizationRole;
}

export interface Creator {
  readonly active: boolean;
  readonly bilibiliUid: string;
  readonly displayName: string;
  readonly id: string;
  readonly organizationId: string;
  readonly roomId: string;
  readonly timezone: string;
}

export interface OrganizationMember {
  readonly creatorIds: readonly string[];
  readonly email?: string;
  readonly id: string;
  readonly name?: string;
  readonly role: OrganizationRole;
  readonly userId: string;
}

export interface BilibiliBinding {
  readonly biliDisplayName: string | null;
  readonly biliUid: string;
  readonly boundAt: string;
  readonly id: string;
}

export interface BilibiliChallenge {
  readonly connectionState: 'CONNECTING' | 'HEALTHY' | 'UNHEALTHY' | null;
  readonly expiresAt: string;
  readonly id: string;
  readonly room: { readonly displayName: string; readonly link: string };
  readonly status: 'ACTIVE' | 'CONSUMED' | 'EXPIRED' | 'CANCELLED' | 'CONFLICT';
}

export interface IssuedBilibiliChallenge {
  readonly code: string;
  readonly expiresAt: string;
  readonly id: string;
  readonly room: { readonly displayName: string; readonly id: string; readonly link: string };
}

export function getIdentity(): Promise<Identity> {
  return apiRequest('/api/v1/me');
}

export function getCreators(organizationId: string): Promise<readonly Creator[]> {
  return apiRequest(`/api/v1/organizations/${organizationId}/creators`);
}

export function getMembers(organizationId: string): Promise<readonly OrganizationMember[]> {
  return apiRequest(`/api/v1/organizations/${organizationId}/members`);
}

export function signIn(email: string, password: string): Promise<unknown> {
  return apiRequest('/api/auth/sign-in/email', {
    body: JSON.stringify({ email, password }),
    method: 'POST',
  });
}

export function register(email: string, name: string, password: string): Promise<unknown> {
  return apiRequest('/api/auth/sign-up/email', {
    body: JSON.stringify({ email, name, password }),
    method: 'POST',
  });
}

export function signOut(): Promise<unknown> {
  return apiRequest('/api/auth/sign-out', { method: 'POST' });
}

export function getBilibiliBinding(): Promise<BilibiliBinding | null> {
  return apiRequest('/api/v1/me/bilibili-binding');
}

export function getCurrentBilibiliChallenge(): Promise<BilibiliChallenge | null> {
  return apiRequest('/api/v1/me/bilibili-challenges/current');
}

export function createBilibiliChallenge(): Promise<IssuedBilibiliChallenge> {
  return apiRequest('/api/v1/me/bilibili-challenges', {
    body: JSON.stringify({}),
    method: 'POST',
  });
}

export function removeBilibiliBinding(): Promise<void> {
  return apiRequest('/api/v1/me/bilibili-binding', { method: 'DELETE' });
}
