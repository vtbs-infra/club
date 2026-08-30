import type {
  BilibiliBinding,
  BilibiliChallenge,
  BindingConflictPage,
  BindingConflictResolutionInput,
  IssuedBilibiliChallenge,
} from '../../shared/contracts/binding';
import { apiRequest } from './http';

export type {
  BilibiliBinding,
  BilibiliChallenge,
  BindingConflict,
  BindingConflictPage,
  IssuedBilibiliChallenge,
} from '../../shared/contracts/binding';

export function getBinding(): Promise<BilibiliBinding | null> {
  return apiRequest('/api/v1/me/bilibili-binding');
}

export function getChallenge(): Promise<BilibiliChallenge | null> {
  return apiRequest('/api/v1/me/bilibili-challenges/current');
}

export function createChallenge(): Promise<IssuedBilibiliChallenge> {
  return apiRequest('/api/v1/me/bilibili-challenges', {
    body: JSON.stringify({}),
    method: 'POST',
  });
}

export function unbindBilibili(): Promise<void> {
  return apiRequest('/api/v1/me/bilibili-binding', { method: 'DELETE' });
}

export function getAdminBindingConflicts(cursor?: string): Promise<BindingConflictPage> {
  const parameters = new URLSearchParams({ limit: '20' });
  if (cursor) parameters.set('cursor', cursor);
  return apiRequest(`/api/v1/admin/bilibili-binding-conflicts?${parameters.toString()}`);
}

export function resolveAdminBindingConflict(
  conflictId: string,
  input: BindingConflictResolutionInput,
): Promise<void> {
  return apiRequest(`/api/v1/admin/bilibili-binding-conflicts/${conflictId}/resolve`, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function dismissAdminBindingConflict(
  conflictId: string,
  input: BindingConflictResolutionInput,
): Promise<void> {
  return apiRequest(`/api/v1/admin/bilibili-binding-conflicts/${conflictId}/dismiss`, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}
