import { apiRequest } from './http';

export interface SnapshotRun {
  readonly acceptedAttemptId: string | null;
  readonly creatorId: string;
  readonly cutoffTimezone: string;
  readonly finalizedAt: string | null;
  readonly id: string;
  readonly onTimeWindowEndAt: string;
  readonly periodStart: string;
  readonly scheduledCutoffAt: string;
  readonly status:
    'SCHEDULED' | 'RUNNING' | 'FAILED' | 'PENDING_APPROVAL' | 'FINALIZED' | 'REJECTED';
}

export interface SnapshotAttempt {
  readonly attemptNumber: number;
  readonly captureCompletedAt: string | null;
  readonly captureStartedAt: string | null;
  readonly consistencyStatus: 'PENDING' | 'CONSISTENT' | 'INCONSISTENT';
  readonly declaredTotal: number | null;
  readonly failureCode: string | null;
  readonly failureMessage: string | null;
  readonly id: string;
  readonly normalizedTotal: number | null;
  readonly punctuality: 'ON_TIME' | 'LATE' | null;
  readonly sourceName: string;
  readonly sourceVersion: string;
}

export interface SnapshotPageEvidence {
  readonly compressedSize: number;
  readonly contentHashSha256: string;
  readonly id: string;
  readonly itemCount: number;
  readonly objectKey: string;
  readonly pageNumber: number;
  readonly snapshotAttemptId: string;
  readonly uncompressedSize: number;
}

export interface SnapshotDetail {
  readonly attempts: SnapshotAttempt[];
  readonly pages: SnapshotPageEvidence[];
  readonly run: SnapshotRun;
}

export const getCreatorSnapshots = (creatorId: string) =>
  apiRequest<SnapshotRun[]>(`/api/v1/creators/${creatorId}/snapshots`);

export const getSnapshot = (runId: string) =>
  apiRequest<SnapshotDetail>(`/api/v1/snapshots/${runId}`);

export const retrySnapshot = (runId: string) =>
  apiRequest<SnapshotDetail>(`/api/v1/snapshots/${runId}/retry`, {
    body: '{}',
    method: 'POST',
  });

export const approveLateSnapshot = (runId: string) =>
  apiRequest<void>(`/api/v1/snapshots/${runId}/approve-late`, {
    body: '{}',
    method: 'POST',
  });

export const rejectLateSnapshot = (runId: string, reason: string) =>
  apiRequest<void>(`/api/v1/snapshots/${runId}/reject-late`, {
    body: JSON.stringify({ reason }),
    method: 'POST',
  });

export const checkSnapshotIntegrity = (runId: string) =>
  apiRequest<Array<{ objectKey: string; ok: boolean; pageNumber: number }>>(
    `/api/v1/snapshots/${runId}/integrity`,
  );
