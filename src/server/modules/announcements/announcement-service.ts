import { and, desc, eq, gt, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';

import type { AnnouncementContent } from '../../../shared/contracts/announcements.js';
import { AppError } from '../../../shared/errors/app-error.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { AppDatabase, DatabaseService } from '../../infrastructure/db/database.js';
import {
  announcementReads,
  announcements,
  bilibiliBindings,
  giftOrders,
} from '../../infrastructure/db/schema/index.js';
import { AuditService, type RequestAuditContext } from '../audit/audit-service.js';

export type AnnouncementTarget =
  { readonly scope: 'PLATFORM' } | { readonly creatorId: string; readonly scope: 'CREATOR' };

interface NormalizedContent {
  readonly body: string;
  readonly expiresAt: Date | null;
  readonly title: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const announcementSummaryColumns = {
  createdAt: announcements.createdAt,
  expiresAt: announcements.expiresAt,
  id: announcements.id,
  pinned: announcements.pinned,
  publicVisible: announcements.publicVisible,
  publishedAt: announcements.publishedAt,
  scope: announcements.scope,
  severity: announcements.severity,
  status: announcements.status,
  title: announcements.title,
  updatedAt: announcements.updatedAt,
  version: announcements.version,
  withdrawnAt: announcements.withdrawnAt,
};

type AnnouncementCursor = { readonly createdAt: string; readonly id: string };

function decodeCursor(value: string): AnnouncementCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid cursor payload.');
    const record = parsed as Record<string, unknown>;
    if (typeof record.createdAt !== 'string' || typeof record.id !== 'string') {
      throw new Error('Invalid cursor fields.');
    }
    if (Number.isNaN(new Date(record.createdAt).getTime()) || !UUID.test(record.id)) {
      throw new Error('Invalid cursor values.');
    }
    return { createdAt: record.createdAt, id: record.id };
  } catch {
    throw new AppError('ANNOUNCEMENT_CURSOR_INVALID', 'The announcement cursor is invalid.', 400);
  }
}

function encodeCursor(row: AnnouncementCursor): string {
  return Buffer.from(JSON.stringify({ createdAt: row.createdAt, id: row.id }), 'utf8').toString(
    'base64url',
  );
}

function normalizeContent(input: AnnouncementContent): NormalizedContent {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || title.length > 200 || !body || body.length > 20_000) {
    throw new AppError('ANNOUNCEMENT_CONTENT_INVALID', 'Announcement content is invalid.', 400);
  }
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    throw new AppError('ANNOUNCEMENT_EXPIRY_INVALID', 'Announcement expiry is invalid.', 400);
  }
  return { body, expiresAt, title };
}

function targetCondition(target: AnnouncementTarget): SQL {
  return and(
    eq(announcements.scope, target.scope),
    target.scope === 'CREATOR'
      ? eq(announcements.creatorId, target.creatorId)
      : isNull(announcements.creatorId),
  )!;
}

function assertVersion(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new AppError(
      'ANNOUNCEMENT_VERSION_CONFLICT',
      'This announcement changed. Reload before continuing.',
      409,
    );
  }
}

function assertExpiryAfterPublication(expiresAt: Date | null, publishedAt: Date): void {
  if (expiresAt && expiresAt <= publishedAt) {
    throw new AppError(
      'ANNOUNCEMENT_EXPIRY_INVALID',
      'Announcement expiry must be after publication.',
      400,
    );
  }
}

function auditSummary(row: typeof announcements.$inferSelect) {
  return {
    publicVisible: row.publicVisible,
    severity: row.severity,
    status: row.status,
    title: row.title,
    version: row.version,
  };
}

export class AnnouncementService {
  private readonly audit: AuditService;

  public constructor(
    private readonly database: DatabaseService,
    private readonly clock: Clock,
  ) {
    this.audit = new AuditService(database);
  }

  private async visibleCondition(userId: string): Promise<SQL> {
    const [binding] = await this.database.orm
      .select({ biliUid: bilibiliBindings.biliUid })
      .from(bilibiliBindings)
      .where(and(eq(bilibiliBindings.userId, userId), isNull(bilibiliBindings.unboundAt)))
      .limit(1);
    const accessibleCreators = this.database.orm
      .selectDistinct({ creatorId: giftOrders.creatorId })
      .from(giftOrders)
      .where(
        binding
          ? or(eq(giftOrders.userId, userId), eq(giftOrders.biliUid, binding.biliUid))
          : eq(giftOrders.userId, userId),
      );
    const now = this.clock.now();
    return and(
      or(
        eq(announcements.scope, 'PLATFORM'),
        and(
          eq(announcements.scope, 'CREATOR'),
          inArray(announcements.creatorId, accessibleCreators),
        ),
      ),
      eq(announcements.status, 'PUBLISHED'),
      lte(announcements.publishedAt, now),
      or(isNull(announcements.expiresAt), gt(announcements.expiresAt, now)),
    )!;
  }

  public async listVisible(
    userId: string,
    input: { readonly cursor?: string | undefined; readonly limit: number },
  ) {
    const cursor = input.cursor ? decodeCursor(input.cursor) : null;
    const rows = await this.database.orm
      .select({
        cursorCreatedAt: sql<string>`${announcements.createdAt}::text`,
        summary: announcementSummaryColumns,
      })
      .from(announcements)
      .where(
        and(
          await this.visibleCondition(userId),
          cursor
            ? sql`(${announcements.createdAt}, ${announcements.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(announcements.createdAt), desc(announcements.id))
      .limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit);
    const reads =
      items.length === 0
        ? []
        : await this.database.orm
            .select({
              announcementId: announcementReads.announcementId,
              announcementVersion: announcementReads.announcementVersion,
            })
            .from(announcementReads)
            .where(
              and(
                eq(announcementReads.userId, userId),
                inArray(
                  announcementReads.announcementId,
                  items.map((row) => row.summary.id),
                ),
              ),
            );
    const readVersions = new Set(
      reads.map((read) => `${read.announcementId}:${read.announcementVersion}`),
    );
    return {
      items: items.map((row) => ({
        ...row.summary,
        read: readVersions.has(`${row.summary.id}:${row.summary.version}`),
      })),
      nextCursor: hasMore
        ? encodeCursor({
            createdAt: items.at(-1)!.cursorCreatedAt,
            id: items.at(-1)!.summary.id,
          })
        : null,
    };
  }

  public async getVisible(userId: string, announcementId: string) {
    const [announcement] = await this.database.orm
      .select()
      .from(announcements)
      .where(and(eq(announcements.id, announcementId), await this.visibleCondition(userId)))
      .limit(1);
    if (!announcement) {
      throw new AppError('ANNOUNCEMENT_NOT_FOUND', 'Announcement not found.', 404);
    }
    const [read] = await this.database.orm
      .select({ announcementVersion: announcementReads.announcementVersion })
      .from(announcementReads)
      .where(
        and(
          eq(announcementReads.userId, userId),
          eq(announcementReads.announcementId, announcementId),
          eq(announcementReads.announcementVersion, announcement.version),
        ),
      )
      .limit(1);
    return { ...announcement, read: Boolean(read) };
  }

  public async listManaged(
    target: AnnouncementTarget,
    input: { readonly cursor?: string | undefined; readonly limit: number },
  ) {
    const cursor = input.cursor ? decodeCursor(input.cursor) : null;
    const rows = await this.database.orm
      .select({
        cursorCreatedAt: sql<string>`${announcements.createdAt}::text`,
        summary: announcementSummaryColumns,
      })
      .from(announcements)
      .where(
        and(
          targetCondition(target),
          cursor
            ? sql`(${announcements.createdAt}, ${announcements.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(announcements.createdAt), desc(announcements.id))
      .limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit);
    return {
      items: items.map((row) => row.summary),
      nextCursor: hasMore
        ? encodeCursor({
            createdAt: items.at(-1)!.cursorCreatedAt,
            id: items.at(-1)!.summary.id,
          })
        : null,
    };
  }

  public async getManaged(target: AnnouncementTarget, announcementId: string) {
    const [announcement] = await this.database.orm
      .select()
      .from(announcements)
      .where(and(eq(announcements.id, announcementId), targetCondition(target)))
      .limit(1);
    if (!announcement) {
      throw new AppError('ANNOUNCEMENT_NOT_FOUND', 'Announcement not found.', 404);
    }
    return announcement;
  }

  private async selectForUpdate(
    transaction: AppDatabase,
    target: AnnouncementTarget,
    announcementId: string,
  ) {
    const [announcement] = await transaction
      .select()
      .from(announcements)
      .where(and(eq(announcements.id, announcementId), targetCondition(target)))
      .limit(1)
      .for('update');
    if (!announcement) {
      throw new AppError('ANNOUNCEMENT_NOT_FOUND', 'Announcement not found.', 404);
    }
    return announcement;
  }

  public async createDraft(
    target: AnnouncementTarget,
    input: AnnouncementContent,
    context: RequestAuditContext,
  ) {
    const normalized = normalizeContent(input);
    return this.database.orm.transaction(async (transaction) => {
      const [created] = await transaction
        .insert(announcements)
        .values({
          body: normalized.body,
          createdByUserId: context.actorUserId,
          creatorId: target.scope === 'CREATOR' ? target.creatorId : null,
          expiresAt: normalized.expiresAt,
          pinned: input.pinned,
          publicVisible: target.scope === 'PLATFORM' && input.publicVisible,
          scope: target.scope,
          severity: input.severity,
          status: 'DRAFT',
          title: normalized.title,
        })
        .returning();
      if (!created) throw new Error('Announcement insert returned no row.');
      await this.audit.record(
        {
          action: 'announcement.created',
          actorUserId: context.actorUserId,
          afterSummary: auditSummary(created),
          creatorId: target.scope === 'CREATOR' ? target.creatorId : undefined,
          ipAddress: context.ipAddress,
          requestId: context.requestId,
          targetId: created.id,
          targetType: 'announcement',
        },
        transaction,
      );
      return created;
    });
  }

  public async saveContent(
    target: AnnouncementTarget,
    announcementId: string,
    input: AnnouncementContent & { readonly expectedVersion: number },
    context: RequestAuditContext,
  ) {
    const normalized = normalizeContent(input);
    return this.database.orm.transaction(async (transaction) => {
      const before = await this.selectForUpdate(transaction, target, announcementId);
      assertVersion(before.version, input.expectedVersion);
      if (before.publishedAt) {
        assertExpiryAfterPublication(normalized.expiresAt, before.publishedAt);
      }
      const [updated] = await transaction
        .update(announcements)
        .set({
          body: normalized.body,
          expiresAt: normalized.expiresAt,
          pinned: input.pinned,
          publicVisible: target.scope === 'PLATFORM' && input.publicVisible,
          severity: input.severity,
          title: normalized.title,
          updatedAt: this.clock.now(),
          version: before.version + 1,
        })
        .where(and(eq(announcements.id, before.id), eq(announcements.version, before.version)))
        .returning();
      if (!updated) {
        throw new AppError(
          'ANNOUNCEMENT_VERSION_CONFLICT',
          'This announcement changed. Reload before continuing.',
          409,
        );
      }
      await this.audit.record(
        {
          action: 'announcement.updated',
          actorUserId: context.actorUserId,
          afterSummary: auditSummary(updated),
          beforeSummary: auditSummary(before),
          creatorId: target.scope === 'CREATOR' ? target.creatorId : undefined,
          ipAddress: context.ipAddress,
          requestId: context.requestId,
          targetId: updated.id,
          targetType: 'announcement',
        },
        transaction,
      );
      return updated;
    });
  }

  public async publish(
    target: AnnouncementTarget,
    announcementId: string,
    expectedVersion: number,
    context: RequestAuditContext,
  ) {
    return this.database.orm.transaction(async (transaction) => {
      const before = await this.selectForUpdate(transaction, target, announcementId);
      assertVersion(before.version, expectedVersion);
      if (before.status !== 'DRAFT' && before.status !== 'WITHDRAWN') {
        throw new AppError(
          'ANNOUNCEMENT_NOT_PUBLISHABLE',
          'Only a draft or withdrawn announcement can be published.',
          409,
        );
      }
      const now = this.clock.now();
      assertExpiryAfterPublication(before.expiresAt, now);
      const [published] = await transaction
        .update(announcements)
        .set({
          publishedAt: now,
          status: 'PUBLISHED',
          updatedAt: now,
          version: before.version + 1,
          withdrawnAt: null,
        })
        .where(and(eq(announcements.id, before.id), eq(announcements.version, before.version)))
        .returning();
      if (!published) {
        throw new AppError(
          'ANNOUNCEMENT_VERSION_CONFLICT',
          'This announcement changed. Reload before continuing.',
          409,
        );
      }
      await this.audit.record(
        {
          action:
            before.status === 'WITHDRAWN' ? 'announcement.republished' : 'announcement.published',
          actorUserId: context.actorUserId,
          afterSummary: auditSummary(published),
          beforeSummary: auditSummary(before),
          creatorId: target.scope === 'CREATOR' ? target.creatorId : undefined,
          ipAddress: context.ipAddress,
          requestId: context.requestId,
          targetId: published.id,
          targetType: 'announcement',
        },
        transaction,
      );
      return published;
    });
  }

  public async withdraw(
    target: AnnouncementTarget,
    announcementId: string,
    expectedVersion: number,
    context: RequestAuditContext,
  ) {
    return this.database.orm.transaction(async (transaction) => {
      const before = await this.selectForUpdate(transaction, target, announcementId);
      assertVersion(before.version, expectedVersion);
      if (before.status !== 'PUBLISHED') {
        throw new AppError(
          'ANNOUNCEMENT_NOT_WITHDRAWABLE',
          'Only a published announcement can be withdrawn.',
          409,
        );
      }
      const now = this.clock.now();
      const [withdrawn] = await transaction
        .update(announcements)
        .set({
          status: 'WITHDRAWN',
          updatedAt: now,
          version: before.version + 1,
          withdrawnAt: now,
        })
        .where(and(eq(announcements.id, before.id), eq(announcements.version, before.version)))
        .returning();
      if (!withdrawn) {
        throw new AppError(
          'ANNOUNCEMENT_VERSION_CONFLICT',
          'This announcement changed. Reload before continuing.',
          409,
        );
      }
      await this.audit.record(
        {
          action: 'announcement.withdrawn',
          actorUserId: context.actorUserId,
          afterSummary: auditSummary(withdrawn),
          beforeSummary: auditSummary(before),
          creatorId: target.scope === 'CREATOR' ? target.creatorId : undefined,
          ipAddress: context.ipAddress,
          requestId: context.requestId,
          targetId: withdrawn.id,
          targetType: 'announcement',
        },
        transaction,
      );
      return withdrawn;
    });
  }

  public async markRead(userId: string, announcementId: string): Promise<void> {
    const announcement = await this.getVisible(userId, announcementId);
    await this.database.orm
      .insert(announcementReads)
      .values({
        announcementId,
        announcementVersion: announcement.version,
        userId,
      })
      .onConflictDoNothing();
  }

  public async deleteDraft(
    target: AnnouncementTarget,
    announcementId: string,
    context: RequestAuditContext,
  ): Promise<void> {
    await this.database.orm.transaction(async (transaction) => {
      const before = await this.selectForUpdate(transaction, target, announcementId);
      if (before.status !== 'DRAFT') {
        throw new AppError(
          'ANNOUNCEMENT_NOT_DELETABLE',
          'Only a draft that has never been published can be deleted.',
          409,
        );
      }
      const [deleted] = await transaction
        .delete(announcements)
        .where(
          and(
            eq(announcements.id, before.id),
            eq(announcements.status, 'DRAFT'),
            eq(announcements.version, before.version),
          ),
        )
        .returning({ id: announcements.id });
      if (!deleted) {
        throw new AppError(
          'ANNOUNCEMENT_VERSION_CONFLICT',
          'This announcement changed. Reload before continuing.',
          409,
        );
      }
      await this.audit.record(
        {
          action: 'announcement.deleted',
          actorUserId: context.actorUserId,
          beforeSummary: auditSummary(before),
          creatorId: target.scope === 'CREATOR' ? target.creatorId : undefined,
          ipAddress: context.ipAddress,
          requestId: context.requestId,
          targetId: deleted.id,
          targetType: 'announcement',
        },
        transaction,
      );
    });
  }
}
