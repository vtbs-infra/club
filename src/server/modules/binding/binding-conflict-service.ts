import { and, desc, eq, isNull, lt, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { AppError } from '../../../shared/errors/app-error.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { AppDatabase, DatabaseService } from '../../infrastructure/db/database.js';
import {
  bilibiliBindings,
  bindingChallenges,
  bindingConflicts,
  creators,
  users,
} from '../../infrastructure/db/schema/index.js';
import { AuditService } from '../audit/audit-service.js';
import type { RequestAuditContext } from '../audit/audit-service.js';
import type { LiveMessageEvent } from '../bilibili/live-message-source.js';

type ConflictExecutor = Pick<AppDatabase, 'insert' | 'select' | 'update'>;

const requestingUsers = alias(users, 'binding_conflict_requesting_users');
const bindingUsers = alias(users, 'binding_conflict_binding_users');
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
    throw new AppError(
      'BILIBILI_BINDING_CONFLICT_CURSOR_INVALID',
      'The binding-conflict cursor is invalid.',
      400,
    );
  }
}

function encodeCursor(row: typeof bindingConflicts.$inferSelect): string {
  return Buffer.from(
    JSON.stringify({ createdAt: row.createdAt.toISOString(), id: row.id }),
    'utf8',
  ).toString('base64url');
}

function normalizeReason(value: string): string {
  const reason = value.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new AppError(
      'BILIBILI_BINDING_CONFLICT_REASON_INVALID',
      'A binding-conflict resolution reason is required.',
      400,
    );
  }
  return reason;
}

export class BindingConflictService {
  private readonly audit: AuditService;

  public constructor(
    private readonly database: DatabaseService,
    private readonly clock: Clock,
  ) {
    this.audit = new AuditService(database);
  }

  public async record(
    executor: ConflictExecutor,
    input: {
      readonly challengeId: string;
      readonly event: LiveMessageEvent;
      readonly observedBindingId: string;
      readonly userId: string;
    },
  ): Promise<boolean> {
    const now = this.clock.now();
    const [updated] = await executor
      .update(bindingChallenges)
      .set({
        consumedAt: now,
        consumedEventId: input.event.eventId,
        status: 'CONFLICT',
        updatedAt: now,
      })
      .where(
        and(eq(bindingChallenges.id, input.challengeId), eq(bindingChallenges.status, 'ACTIVE')),
      )
      .returning({ id: bindingChallenges.id });
    if (!updated) return false;

    const [conflict] = await executor
      .insert(bindingConflicts)
      .values({
        biliUid: input.event.biliUid,
        challengeId: input.challengeId,
        observedBindingId: input.observedBindingId,
      })
      .returning({ id: bindingConflicts.id });
    if (!conflict) throw new Error('Binding-conflict insert returned no row.');
    await this.audit.record(
      {
        action: 'bilibili-binding.conflict-opened',
        actorUserId: input.userId,
        afterSummary: {
          biliUid: input.event.biliUid,
          eventId: input.event.eventId,
          observedBindingId: input.observedBindingId,
        },
        targetId: conflict.id,
        targetType: 'binding-conflict',
      },
      executor,
    );
    return true;
  }

  public async listOpen(input: { readonly cursor?: string | undefined; readonly limit: number }) {
    const cursor = input.cursor ? decodeCursor(input.cursor) : null;
    const rows = await this.database.orm
      .select({
        binding: bilibiliBindings,
        bindingUserEmail: bindingUsers.email,
        bindingUserName: bindingUsers.name,
        conflict: bindingConflicts,
        requestingUserEmail: requestingUsers.email,
        requestingUserId: requestingUsers.id,
        requestingUserName: requestingUsers.name,
      })
      .from(bindingConflicts)
      .innerJoin(bindingChallenges, eq(bindingChallenges.id, bindingConflicts.challengeId))
      .innerJoin(requestingUsers, eq(requestingUsers.id, bindingChallenges.userId))
      .innerJoin(bilibiliBindings, eq(bilibiliBindings.id, bindingConflicts.observedBindingId))
      .innerJoin(bindingUsers, eq(bindingUsers.id, bilibiliBindings.userId))
      .where(
        and(
          eq(bindingConflicts.status, 'OPEN'),
          cursor
            ? or(
                lt(bindingConflicts.createdAt, cursor.createdAt),
                and(
                  eq(bindingConflicts.createdAt, cursor.createdAt),
                  lt(bindingConflicts.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(bindingConflicts.createdAt), desc(bindingConflicts.id))
      .limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit);
    return {
      items: items.map((row) => ({
        biliUid: row.conflict.biliUid,
        challengeId: row.conflict.challengeId,
        createdAt: row.conflict.createdAt,
        id: row.conflict.id,
        observedBinding: {
          biliDisplayName: row.binding.biliDisplayName,
          biliUid: row.binding.biliUid,
          boundAt: row.binding.boundAt,
          id: row.binding.id,
          unboundAt: row.binding.unboundAt,
          user: {
            email: row.bindingUserEmail,
            id: row.binding.userId,
            name: row.bindingUserName,
          },
        },
        requestingUser: {
          email: row.requestingUserEmail,
          id: row.requestingUserId,
          name: row.requestingUserName,
        },
        status: row.conflict.status,
      })),
      nextCursor: hasMore ? encodeCursor(items.at(-1)!.conflict) : null,
    };
  }

  private async lockOpenConflict(executor: ConflictExecutor, conflictId: string) {
    const [conflict] = await executor
      .select()
      .from(bindingConflicts)
      .where(eq(bindingConflicts.id, conflictId))
      .limit(1)
      .for('update');
    if (!conflict) {
      throw new AppError('BILIBILI_BINDING_CONFLICT_NOT_FOUND', 'Binding conflict not found.', 404);
    }
    if (conflict.status !== 'OPEN') {
      throw new AppError(
        'BILIBILI_BINDING_CONFLICT_CLOSED',
        'The binding conflict has already been closed.',
        409,
      );
    }

    const [binding] = await executor
      .select()
      .from(bilibiliBindings)
      .where(eq(bilibiliBindings.id, conflict.observedBindingId))
      .limit(1)
      .for('update');
    const [challenge] = await executor
      .select({ id: bindingChallenges.id, status: bindingChallenges.status })
      .from(bindingChallenges)
      .where(eq(bindingChallenges.id, conflict.challengeId))
      .limit(1)
      .for('update');
    if (!binding || !challenge || challenge.status !== 'CONFLICT') {
      throw new AppError(
        'BILIBILI_BINDING_CONFLICT_EVIDENCE_CHANGED',
        'The binding-conflict evidence no longer matches the recorded request.',
        409,
      );
    }
    return { binding, challenge, conflict };
  }

  public async resolve(
    input: RequestAuditContext & { readonly conflictId: string; readonly reason: string },
  ): Promise<void> {
    const reason = normalizeReason(input.reason);
    await this.database.orm.transaction(async (transaction) => {
      const { binding, conflict } = await this.lockOpenConflict(transaction, input.conflictId);
      const now = this.clock.now();
      let bindingRemoved = false;
      if (binding.unboundAt === null) {
        const [creator] = await transaction
          .select({ id: creators.id })
          .from(creators)
          .where(eq(creators.bindingId, binding.id))
          .limit(1)
          .for('update');
        if (creator) {
          throw new AppError(
            'CREATOR_BILIBILI_BINDING_IMMUTABLE',
            'A creator account cannot replace its verified Bilibili identity.',
            409,
          );
        }
        const [removed] = await transaction
          .update(bilibiliBindings)
          .set({ unboundAt: now, updatedAt: now })
          .where(and(eq(bilibiliBindings.id, binding.id), isNull(bilibiliBindings.unboundAt)))
          .returning({ id: bilibiliBindings.id });
        if (!removed) {
          throw new AppError(
            'BILIBILI_BINDING_CONFLICT_EVIDENCE_CHANGED',
            'The observed binding changed while the conflict was being resolved.',
            409,
          );
        }
        bindingRemoved = true;
        await this.audit.record(
          {
            action: 'bilibili-binding.conflict-binding-removed',
            actorUserId: input.actorUserId,
            beforeSummary: { biliUid: binding.biliUid, userId: binding.userId },
            ipAddress: input.ipAddress,
            reason,
            requestId: input.requestId,
            targetId: binding.id,
            targetType: 'bilibili-binding',
          },
          transaction,
        );
      }

      await transaction
        .update(bindingConflicts)
        .set({
          closedAt: now,
          closedByUserId: input.actorUserId,
          resolutionReason: reason,
          status: 'RESOLVED',
          updatedAt: now,
        })
        .where(eq(bindingConflicts.id, conflict.id));
      await this.audit.record(
        {
          action: 'bilibili-binding.conflict-resolved',
          actorUserId: input.actorUserId,
          afterSummary: { bindingRemoved, observedBindingId: binding.id, status: 'RESOLVED' },
          ipAddress: input.ipAddress,
          reason,
          requestId: input.requestId,
          targetId: conflict.id,
          targetType: 'binding-conflict',
        },
        transaction,
      );
    });
  }

  public async dismiss(
    input: RequestAuditContext & { readonly conflictId: string; readonly reason: string },
  ): Promise<void> {
    const reason = normalizeReason(input.reason);
    await this.database.orm.transaction(async (transaction) => {
      const { binding, conflict } = await this.lockOpenConflict(transaction, input.conflictId);
      const now = this.clock.now();
      await transaction
        .update(bindingConflicts)
        .set({
          closedAt: now,
          closedByUserId: input.actorUserId,
          resolutionReason: reason,
          status: 'DISMISSED',
          updatedAt: now,
        })
        .where(eq(bindingConflicts.id, conflict.id));
      await this.audit.record(
        {
          action: 'bilibili-binding.conflict-dismissed',
          actorUserId: input.actorUserId,
          afterSummary: { observedBindingId: binding.id, status: 'DISMISSED' },
          ipAddress: input.ipAddress,
          reason,
          requestId: input.requestId,
          targetId: conflict.id,
          targetType: 'binding-conflict',
        },
        transaction,
      );
    });
  }
}
