import { desc, lt } from 'drizzle-orm';

import type { DatabaseService } from '../../infrastructure/db/database.js';
import { auditLogs } from '../../infrastructure/db/schema.js';

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

function response(row: typeof auditLogs.$inferSelect) {
  return {
    action: row.action,
    actorUserId: row.actorUserId,
    afterSummary: redactAuditValue(row.afterSummary),
    beforeSummary: redactAuditValue(row.beforeSummary),
    createdAt: row.createdAt.toISOString(),
    creatorId: row.creatorId,
    id: row.id,
    reason: row.reason,
    requestId: row.requestId,
    targetId: row.targetId,
    targetType: row.targetType,
  };
}

export class AuditQueryService {
  public constructor(private readonly database: DatabaseService) {}

  public async listPlatform(input: { readonly before?: Date | undefined; readonly limit: number }) {
    const rows = await this.database.orm
      .select()
      .from(auditLogs)
      .where(input.before ? lt(auditLogs.createdAt, input.before) : undefined)
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit);
    return {
      items: items.map(response),
      nextBefore: hasMore ? items.at(-1)!.createdAt.toISOString() : null,
    };
  }
}
