import { apiRequest } from './http';

export interface AuditLog {
  readonly action: string;
  readonly actorUserId: string | null;
  readonly afterSummary: unknown;
  readonly beforeSummary: unknown;
  readonly createdAt: string;
  readonly creatorId: string | null;
  readonly id: string;
  readonly organizationId: string | null;
  readonly reason: string | null;
  readonly requestId: string | null;
  readonly targetId: string;
  readonly targetType: string;
}

export interface AuditPage {
  readonly items: readonly AuditLog[];
  readonly nextBefore: string | null;
}

interface DependencyChecks {
  readonly database: 'ok' | 'down';
  readonly storage: 'ok' | 'down';
}

interface SchedulerStatus {
  readonly snapshot: { readonly lastTickAt: string | null; readonly running: boolean };
  readonly tracking: {
    readonly configured: boolean;
    readonly lastTickAt: string | null;
    readonly running: boolean;
  };
}

interface SnapshotFailure {
  readonly createdAt: string;
  readonly creatorId: string;
  readonly failureCode: string;
  readonly runId: string;
}

export interface OrganizationSystemStatus {
  readonly checks: DependencyChecks;
  readonly integrityWarningCount: number;
  readonly recentSnapshotFailures: readonly SnapshotFailure[];
  readonly roomHealthCounts: Readonly<Record<string, number>>;
  readonly schedulers: SchedulerStatus;
  readonly snapshotRunCounts: Readonly<Record<string, number>>;
  readonly status: 'ok' | 'degraded';
  readonly tracking: { readonly dueCount: number; readonly exceptionCount: number };
  readonly version: string;
}

export interface PlatformSystemStatus {
  readonly checks: DependencyChecks;
  readonly integrityWarnings: readonly {
    readonly creatorId: string;
    readonly organizationId: string;
    readonly pageId: string;
    readonly runId: string;
  }[];
  readonly recentSnapshotFailures: readonly SnapshotFailure[];
  readonly rooms: readonly {
    readonly displayName: string;
    readonly enabled: boolean;
    readonly healthStatus: string;
    readonly lastConnectedAt: string | null;
  }[];
  readonly schedulers: SchedulerStatus;
  readonly snapshotRunCounts: Readonly<Record<string, number>>;
  readonly status: 'ok' | 'degraded';
  readonly tracking: {
    readonly dueCount: number;
    readonly shipmentCounts: Readonly<Record<string, number>>;
  };
  readonly version: string;
}

export const getOrganizationAuditLogs = (organizationId: string) =>
  apiRequest<AuditPage>(`/api/v1/organizations/${organizationId}/audit-logs`);

export const getPlatformAuditLogs = () => apiRequest<AuditPage>('/api/v1/platform/audit-logs');

export const getOrganizationSystemStatus = (organizationId: string) =>
  apiRequest<OrganizationSystemStatus>(`/api/v1/organizations/${organizationId}/system-status`);

export const getPlatformSystemStatus = () =>
  apiRequest<PlatformSystemStatus>('/api/v1/platform/system-status');
