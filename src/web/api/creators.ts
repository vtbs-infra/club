import type {
  CreatorOverview,
  CreatorRecord,
  Identity,
  UserRecord,
} from '../../shared/contracts/creators';
import { apiRequest } from './http';

export type { CreatorRecord, UserRecord };

export function refreshCreatorProfile(): Promise<Identity['creator']> {
  return apiRequest('/api/v1/creator/profile/refresh', {
    body: JSON.stringify({}),
    method: 'POST',
  });
}

export function getAdminOverview(): Promise<CreatorOverview> {
  return apiRequest('/api/v1/admin/overview');
}

export function getAdminUsers(search = ''): Promise<readonly UserRecord[]> {
  return apiRequest(`/api/v1/admin/users?search=${encodeURIComponent(search)}`);
}

export function getAdminCreators(): Promise<readonly CreatorRecord[]> {
  return apiRequest('/api/v1/admin/creators');
}

export function createAdminCreator(input: {
  readonly monthlySyncEnabled?: boolean;
  readonly timezone: string;
  readonly userId: string;
}): Promise<CreatorRecord> {
  return apiRequest('/api/v1/admin/creators', {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function updateAdminCreator(
  creatorId: string,
  input: {
    readonly monthlySyncEnabled?: boolean;
    readonly timezone?: string;
  },
): Promise<CreatorRecord> {
  return apiRequest(`/api/v1/admin/creators/${creatorId}`, {
    body: JSON.stringify(input),
    method: 'PATCH',
  });
}

export function refreshAdminCreatorProfile(creatorId: string): Promise<CreatorRecord> {
  return apiRequest(`/api/v1/admin/creators/${creatorId}/refresh-profile`, {
    body: JSON.stringify({}),
    method: 'POST',
  });
}
