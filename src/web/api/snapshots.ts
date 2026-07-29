import type {
  AdminSnapshot,
  SnapshotDetail,
  SnapshotIntegrityResult,
  SnapshotRun,
} from '../../shared/contracts/snapshots';
import { apiRequest } from './http';

export type { AdminSnapshot, SnapshotDetail, SnapshotIntegrityResult, SnapshotRun };

export function getCreatorRosters(): Promise<readonly SnapshotRun[]> {
  return apiRequest('/api/v1/creator/rosters');
}

export function getAdminRosters(): Promise<readonly AdminSnapshot[]> {
  return apiRequest('/api/v1/admin/rosters');
}

export function getAdminRoster(snapshotRunId: string): Promise<SnapshotDetail> {
  return apiRequest(`/api/v1/admin/rosters/${snapshotRunId}`);
}

export function getAdminRosterIntegrity(
  snapshotRunId: string,
): Promise<readonly SnapshotIntegrityResult[]> {
  return apiRequest(`/api/v1/admin/rosters/${snapshotRunId}/integrity`);
}

export function retryAdminRoster(snapshotRunId: string): Promise<{ readonly attemptId: string }> {
  return apiRequest(`/api/v1/admin/rosters/${snapshotRunId}/retry`, {
    body: JSON.stringify({}),
    method: 'POST',
  });
}

export function approveAdminRoster(snapshotRunId: string): Promise<void> {
  return apiRequest(`/api/v1/admin/rosters/${snapshotRunId}/approve-late`, {
    body: JSON.stringify({}),
    method: 'POST',
  });
}

export function rejectAdminRoster(snapshotRunId: string, reason: string): Promise<void> {
  return apiRequest(`/api/v1/admin/rosters/${snapshotRunId}/reject-late`, {
    body: JSON.stringify({ reason }),
    method: 'POST',
  });
}
