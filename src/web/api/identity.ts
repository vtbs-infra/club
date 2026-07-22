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
