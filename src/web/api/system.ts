import type { AuditLogPage } from '../../shared/contracts/audit';
import type { SystemStatus } from '../../shared/contracts/system';
import { apiRequest } from './http';

export type { AuditLogPage, SystemStatus };

export function getAdminSystem(): Promise<SystemStatus> {
  return apiRequest('/api/v1/admin/system');
}

export function getAdminAuditLogs(cursor?: string): Promise<AuditLogPage> {
  const parameters = new URLSearchParams({ limit: '20' });
  if (cursor) parameters.set('cursor', cursor);
  return apiRequest(`/api/v1/admin/audit-logs?${parameters.toString()}`);
}
