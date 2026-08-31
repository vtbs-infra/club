import type {
  AdminSnapshot,
  AdminSnapshotPage,
  SnapshotDetail,
  SnapshotIntegrityResult,
  SnapshotIntegrityResultPage,
  SnapshotMemberPage,
  SnapshotPagePage,
  SnapshotRun,
  SnapshotRunPage,
} from '../../shared/contracts/snapshots';
import { apiRequest } from './http';

export type {
  AdminSnapshot,
  AdminSnapshotPage,
  SnapshotDetail,
  SnapshotIntegrityResult,
  SnapshotIntegrityResultPage,
  SnapshotMemberPage,
  SnapshotPagePage,
  SnapshotRun,
  SnapshotRunPage,
};

function pageQuery(input: Readonly<Record<string, number | string | undefined>>): string {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== '') parameters.set(key, String(value));
  }
  const query = parameters.toString();
  return query ? `?${query}` : '';
}

export function getCreatorRosters(
  input: {
    readonly cursor?: string | undefined;
    readonly limit?: number | undefined;
  } = {},
): Promise<SnapshotRunPage> {
  return apiRequest(`/api/v1/creator/rosters${pageQuery(input)}`);
}

export function getAdminRosters(
  input: {
    readonly creatorId?: string | undefined;
    readonly cursor?: string | undefined;
    readonly limit?: number | undefined;
  } = {},
): Promise<AdminSnapshotPage> {
  return apiRequest(`/api/v1/admin/rosters${pageQuery(input)}`);
}

export function getAdminRoster(snapshotRunId: string): Promise<SnapshotDetail> {
  return apiRequest(`/api/v1/admin/rosters/${snapshotRunId}`);
}

export function getAdminRosterMembers(
  snapshotRunId: string,
  input: {
    readonly cursor?: string | undefined;
    readonly limit?: number | undefined;
    readonly search?: string | undefined;
  } = {},
): Promise<SnapshotMemberPage> {
  return apiRequest(`/api/v1/admin/rosters/${snapshotRunId}/members${pageQuery(input)}`);
}

export function getAdminRosterPages(
  snapshotRunId: string,
  snapshotAttemptId: string,
  input: { readonly cursor?: string | undefined; readonly limit?: number | undefined } = {},
): Promise<SnapshotPagePage> {
  return apiRequest(
    `/api/v1/admin/rosters/${snapshotRunId}/attempts/${snapshotAttemptId}/pages${pageQuery(input)}`,
  );
}

export function getAdminRosterIntegrity(
  snapshotRunId: string,
  snapshotAttemptId: string,
  input: { readonly cursor?: string | undefined; readonly limit?: number | undefined } = {},
): Promise<SnapshotIntegrityResultPage> {
  return apiRequest(
    `/api/v1/admin/rosters/${snapshotRunId}/attempts/${snapshotAttemptId}/integrity${pageQuery(input)}`,
  );
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
