import type {
  CreatorOverview,
  CreatorRecord,
  CreatorRecordPage,
  Identity,
  UserRecord,
} from '../../shared/contracts/creators';
import { apiRequest } from './http';

export type { CreatorRecord, CreatorRecordPage, UserRecord };

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

export function getAdminCreators(
  input: {
    readonly cursor?: string | undefined;
    readonly limit?: number | undefined;
  } = {},
): Promise<CreatorRecordPage> {
  const parameters = new URLSearchParams();
  if (input.cursor) parameters.set('cursor', input.cursor);
  if (input.limit) parameters.set('limit', String(input.limit));
  const query = parameters.toString();
  return apiRequest(`/api/v1/admin/creators${query ? `?${query}` : ''}`);
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
