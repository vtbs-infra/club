import { desc, eq, lt } from 'drizzle-orm';

import type { DatabaseService } from '../../infrastructure/db/database.js';
import { auditLogs, users } from '../../infrastructure/db/schema/index.js';

const SENSITIVE_KEY =
  /authorization|password|token|secret|cookie|address|phone|recipient|tracking|csv|ciphertext|initialization|authentication/i;

export function redactAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAuditValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactAuditValue(item),
    ]),
  );
}

function response(row: {
  readonly actorEmail: null | string;
  readonly actorName: null | string;
  readonly log: typeof auditLogs.$inferSelect;
}) {
  return {
    action: row.log.action,
    actorEmail: row.actorEmail,
    actorName: row.actorName,
    actorUserId: row.log.actorUserId,
    afterSummary: redactAuditValue(row.log.afterSummary),
    beforeSummary: redactAuditValue(row.log.beforeSummary),
    createdAt: row.log.createdAt.toISOString(),
    creatorId: row.log.creatorId,
    id: row.log.id,
    reason: row.log.reason,
    requestId: row.log.requestId,
    targetId: row.log.targetId,
    targetType: row.log.targetType,
  };
}

export class AuditQueryService {
  public constructor(private readonly database: DatabaseService) {}

  public async listPlatform(input: { readonly before?: Date | undefined; readonly limit: number }) {
    const rows = await this.database.orm
      .select({
        actorEmail: users.email,
        actorName: users.name,
        log: auditLogs,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(input.before ? lt(auditLogs.createdAt, input.before) : undefined)
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit);
    return {
      items: items.map(response),
      nextBefore: hasMore ? items.at(-1)!.log.createdAt.toISOString() : null,
    };
  }
}
