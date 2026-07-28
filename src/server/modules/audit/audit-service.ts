import type { AppDatabase, DatabaseService } from '../../infrastructure/db/database.js';
import { auditLogs } from '../../infrastructure/db/schema.js';

type AuditExecutor = Pick<AppDatabase, 'insert'>;

export interface AuditEvent {
  readonly action: string;
  readonly actorUserId: string | null;
  readonly afterSummary?: Record<string, unknown> | null;
  readonly beforeSummary?: Record<string, unknown> | null;
  readonly creatorId?: string | null | undefined;
  readonly ipAddress?: string | null | undefined;
  readonly reason?: string | null | undefined;
  readonly requestId?: string | null | undefined;
  readonly targetId: string;
  readonly targetType: string;
}

export class AuditService {
  public constructor(private readonly database: DatabaseService) {}

  public async record(
    event: AuditEvent,
    executor: AuditExecutor = this.database.orm,
  ): Promise<void> {
    await executor.insert(auditLogs).values({
      action: event.action,
      actorUserId: event.actorUserId,
      afterSummary: event.afterSummary ?? null,
      beforeSummary: event.beforeSummary ?? null,
      creatorId: event.creatorId ?? null,
      ipAddress: event.ipAddress ?? null,
      reason: event.reason ?? null,
      requestId: event.requestId ?? null,
      targetId: event.targetId,
      targetType: event.targetType,
    });
  }
}

export interface RequestAuditContext {
  readonly actorUserId: string;
  readonly ipAddress?: string | null;
  readonly requestId?: string | null;
}
