import { and, desc, eq, gt, inArray, isNull, lte, or, type SQL } from 'drizzle-orm';

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

  public async listVisible(userId: string, limit?: number) {
    const [binding] = await this.database.orm
      .select({ biliUid: bilibiliBindings.biliUid })
      .from(bilibiliBindings)
      .where(and(eq(bilibiliBindings.userId, userId), isNull(bilibiliBindings.unboundAt)))
      .limit(1);
    const accessibleOrders = await this.database.orm
      .selectDistinct({ creatorId: giftOrders.creatorId })
      .from(giftOrders)
      .where(
        binding
          ? or(eq(giftOrders.userId, userId), eq(giftOrders.biliUid, binding.biliUid))
          : eq(giftOrders.userId, userId),
      );
    const creatorIds = accessibleOrders.map((row) => row.creatorId);
    const now = this.clock.now();
    const visibility =
      creatorIds.length === 0
        ? eq(announcements.scope, 'PLATFORM')
        : or(
            eq(announcements.scope, 'PLATFORM'),
            and(eq(announcements.scope, 'CREATOR'), inArray(announcements.creatorId, creatorIds)),
          );
    const query = this.database.orm
      .select()
      .from(announcements)
      .where(
        and(
          visibility,
          eq(announcements.status, 'PUBLISHED'),
          lte(announcements.publishedAt, now),
          or(isNull(announcements.expiresAt), gt(announcements.expiresAt, now)),
        ),
      )
      .orderBy(desc(announcements.pinned), desc(announcements.publishedAt));
    const rows = limit === undefined ? await query : await query.limit(limit);
    const reads =
      rows.length === 0
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
                  rows.map((row) => row.id),
                ),
              ),
            );
    const readVersions = new Set(
      reads.map((read) => `${read.announcementId}:${read.announcementVersion}`),
    );
    return rows.map((row) => ({
      ...row,
      read: readVersions.has(`${row.id}:${row.version}`),
    }));
  }

  public listManaged(target: AnnouncementTarget) {
    return this.database.orm
      .select()
      .from(announcements)
      .where(targetCondition(target))
      .orderBy(desc(announcements.createdAt));
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
    const [announcement] = (await this.listVisible(userId)).filter(
      (candidate) => candidate.id === announcementId,
    );
    if (!announcement) {
      throw new AppError('ANNOUNCEMENT_NOT_FOUND', 'Announcement not found.', 404);
    }
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
