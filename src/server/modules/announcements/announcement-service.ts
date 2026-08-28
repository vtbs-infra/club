import { and, desc, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';

import { AppError } from '../../../shared/errors/app-error.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import {
  announcementReads,
  announcements,
  bilibiliBindings,
  giftOrders,
} from '../../infrastructure/db/schema/index.js';
import { AuditService, type RequestAuditContext } from '../audit/audit-service.js';

export interface AnnouncementInput {
  readonly body: string;
  readonly expiresAt?: null | string;
  readonly pinned: boolean;
  readonly publicVisible: boolean;
  readonly publishNow: boolean;
  readonly severity: 'INFO' | 'WARNING' | 'CRITICAL';
  readonly title: string;
}

function validate(input: AnnouncementInput) {
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

  public listManaged(scope: 'PLATFORM' | 'CREATOR', creatorId?: string) {
    return this.database.orm
      .select()
      .from(announcements)
      .where(
        and(
          eq(announcements.scope, scope),
          scope === 'CREATOR'
            ? eq(announcements.creatorId, creatorId!)
            : isNull(announcements.creatorId),
        ),
      )
      .orderBy(desc(announcements.createdAt));
  }

  public async create(
    target: { readonly creatorId?: string; readonly scope: 'PLATFORM' | 'CREATOR' },
    input: AnnouncementInput,
    context: RequestAuditContext,
  ) {
    const normalized = validate(input);
    const now = this.clock.now();
    if (normalized.expiresAt && input.publishNow && normalized.expiresAt <= now) {
      throw new AppError(
        'ANNOUNCEMENT_EXPIRY_INVALID',
        'Announcement expiry must be after publication.',
        400,
      );
    }
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
          publishedAt: input.publishNow ? now : null,
          scope: target.scope,
          severity: input.severity,
          title: normalized.title,
        })
        .returning();
      if (!created) throw new Error('Announcement insert returned no row.');
      await this.audit.record(
        {
          action: 'announcement.created',
          actorUserId: context.actorUserId,
          afterSummary: {
            published: Boolean(created.publishedAt),
            publicVisible: created.publicVisible,
            scope: created.scope,
            severity: created.severity,
            title: created.title,
          },
          creatorId: target.creatorId,
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

  public async update(
    target: { readonly creatorId?: string; readonly scope: 'PLATFORM' | 'CREATOR' },
    announcementId: string,
    input: AnnouncementInput & { readonly expectedVersion: number },
    context: RequestAuditContext,
  ) {
    const normalized = validate(input);
    return this.database.orm.transaction(async (transaction) => {
      const [before] = await transaction
        .select()
        .from(announcements)
        .where(
          and(
            eq(announcements.id, announcementId),
            eq(announcements.scope, target.scope),
            target.scope === 'CREATOR'
              ? eq(announcements.creatorId, target.creatorId!)
              : isNull(announcements.creatorId),
          ),
        )
        .limit(1)
        .for('update');
      if (!before) throw new AppError('ANNOUNCEMENT_NOT_FOUND', 'Announcement not found.', 404);
      if (before.version !== input.expectedVersion) {
        throw new AppError(
          'ANNOUNCEMENT_VERSION_CONFLICT',
          'This announcement changed. Reload before saving.',
          409,
        );
      }
      const now = this.clock.now();
      const publishedAt = input.publishNow ? (before.publishedAt ?? now) : null;
      if (normalized.expiresAt && publishedAt && normalized.expiresAt <= publishedAt) {
        throw new AppError(
          'ANNOUNCEMENT_EXPIRY_INVALID',
          'Announcement expiry must be after publication.',
          400,
        );
      }
      const [updated] = await transaction
        .update(announcements)
        .set({
          body: normalized.body,
          expiresAt: normalized.expiresAt,
          pinned: input.pinned,
          publicVisible: target.scope === 'PLATFORM' && input.publicVisible,
          publishedAt,
          severity: input.severity,
          title: normalized.title,
          updatedAt: now,
          version: before.version + 1,
        })
        .where(and(eq(announcements.id, before.id), eq(announcements.version, before.version)))
        .returning();
      if (!updated) {
        throw new AppError(
          'ANNOUNCEMENT_VERSION_CONFLICT',
          'This announcement changed. Reload before saving.',
          409,
        );
      }
      await this.audit.record(
        {
          action: 'announcement.updated',
          actorUserId: context.actorUserId,
          afterSummary: {
            published: Boolean(updated.publishedAt),
            publicVisible: updated.publicVisible,
            severity: updated.severity,
            title: updated.title,
          },
          beforeSummary: {
            published: Boolean(before.publishedAt),
            publicVisible: before.publicVisible,
            severity: before.severity,
            title: before.title,
          },
          creatorId: target.creatorId,
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

  public async markRead(userId: string, announcementId: string): Promise<void> {
    const [announcement] = (await this.listVisible(userId)).filter(
      (announcement) => announcement.id === announcementId,
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
    target: { readonly creatorId?: string; readonly scope: 'PLATFORM' | 'CREATOR' },
    announcementId: string,
    context: RequestAuditContext,
  ): Promise<void> {
    await this.database.orm.transaction(async (transaction) => {
      const [deleted] = await transaction
        .delete(announcements)
        .where(
          and(
            eq(announcements.id, announcementId),
            eq(announcements.scope, target.scope),
            isNull(announcements.publishedAt),
            target.scope === 'CREATOR'
              ? eq(announcements.creatorId, target.creatorId!)
              : isNull(announcements.creatorId),
          ),
        )
        .returning({ id: announcements.id });
      if (!deleted) {
        throw new AppError(
          'ANNOUNCEMENT_NOT_DELETABLE',
          'Only an unpublished announcement can be deleted.',
          409,
        );
      }
      await this.audit.record(
        {
          action: 'announcement.deleted',
          actorUserId: context.actorUserId,
          creatorId: target.creatorId,
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
