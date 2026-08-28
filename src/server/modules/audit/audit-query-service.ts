import { and, desc, eq, lt, or } from 'drizzle-orm';

import { AppError } from '../../../shared/errors/app-error.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import { auditLogs, users } from '../../infrastructure/db/schema/index.js';

const SENSITIVE_KEY =
  /authorization|password|token|secret|cookie|address|phone|recipient|tracking|csv|ciphertext|initialization|authentication/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function decodeCursor(value: string): { readonly createdAt: Date; readonly id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid cursor payload.');
    const record = parsed as Record<string, unknown>;
    if (typeof record.createdAt !== 'string' || typeof record.id !== 'string') {
      throw new Error('Invalid cursor fields.');
    }
    const createdAt = new Date(record.createdAt);
    if (Number.isNaN(createdAt.getTime()) || !UUID.test(record.id)) {
      throw new Error('Invalid cursor values.');
    }
    return { createdAt, id: record.id };
  } catch {
    throw new AppError('AUDIT_CURSOR_INVALID', 'The audit log cursor is invalid.', 400);
  }
}

function encodeCursor(row: typeof auditLogs.$inferSelect): string {
  return Buffer.from(
    JSON.stringify({ createdAt: row.createdAt.toISOString(), id: row.id }),
    'utf8',
  ).toString('base64url');
}

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

  public async listPlatform(input: {
    readonly cursor?: string | undefined;
    readonly limit: number;
  }) {
    const cursor = input.cursor ? decodeCursor(input.cursor) : null;
    const rows = await this.database.orm
      .select({
        actorEmail: users.email,
        actorName: users.name,
        log: auditLogs,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(
        cursor
          ? or(
              lt(auditLogs.createdAt, cursor.createdAt),
              and(eq(auditLogs.createdAt, cursor.createdAt), lt(auditLogs.id, cursor.id)),
            )
          : undefined,
      )
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit);
    return {
      items: items.map(response),
      nextCursor: hasMore ? encodeCursor(items.at(-1)!.log) : null,
    };
  }
}
