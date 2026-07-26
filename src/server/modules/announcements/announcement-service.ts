import { and, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';

import { AppError } from '../../../shared/errors/app-error.js';
import {
  hasOrganizationPermission,
  isOrganizationRole,
} from '../../../shared/permissions/permissions.js';
import type { AppDatabase, DatabaseService } from '../../infrastructure/db/database.js';
import {
  announcementReads,
  announcements,
  bilibiliBindings,
  entitlements,
  giftCampaigns,
  memberCreatorScopes,
  organizationMembers,
  creators,
} from '../../infrastructure/db/schema.js';
import { AuditService } from '../audit/audit-service.js';
import type { AuthSession } from '../auth/auth.js';
import type { RequestAuditContext } from '../campaigns/campaign-service.js';
import {
  announcementVisibleToUser,
  validateAnnouncementContent,
  type AnnouncementScope,
  type AnnouncementSeverity,
} from './announcement-domain.js';

export interface CreateAnnouncementInput {
  readonly body: string;
  readonly campaignId?: string | null | undefined;
  readonly creatorId?: string | null | undefined;
  readonly expiresAt?: Date | null | undefined;
  readonly pinned: boolean;
  readonly publishedAt?: Date | null | undefined;
  readonly scope: AnnouncementScope;
  readonly severity: AnnouncementSeverity;
  readonly title: string;
}

export interface UpdateAnnouncementInput {
  readonly body?: string | undefined;
  readonly expiresAt?: Date | null | undefined;
  readonly pinned?: boolean | undefined;
  readonly publishedAt?: Date | null | undefined;
  readonly severity?: AnnouncementSeverity | undefined;
  readonly title?: string | undefined;
  readonly version: number;
}

function response(row: typeof announcements.$inferSelect, readAt: Date | null = null) {
  return {
    body: row.body,
    campaignId: row.campaignId,
    createdAt: row.createdAt.toISOString(),
    creatorId: row.creatorId,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    id: row.id,
    organizationId: row.organizationId,
    pinned: row.pinned,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    readAt: readAt?.toISOString() ?? null,
    scope: row.scope as AnnouncementScope,
    severity: row.severity as AnnouncementSeverity,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

export class AnnouncementService {
  private readonly audit: AuditService;

  public constructor(private readonly database: DatabaseService) {
    this.audit = new AuditService(database);
  }

  private async databaseNow(executor: AppDatabase): Promise<Date> {
    const [row] = await executor.execute<{ value: Date | string }>(sql`select now() as value`);
    return row!.value instanceof Date ? row!.value : new Date(row!.value);
  }

  public async listForUser(userId: string) {
    const now = await this.databaseNow(this.database.orm);
    const [active, memberships, bindings, reads] = await Promise.all([
      this.database.orm
        .select()
        .from(announcements)
        .where(
          and(
            lte(announcements.publishedAt, now),
            or(isNull(announcements.expiresAt), gt(announcements.expiresAt, now)),
          ),
        )
        .orderBy(desc(announcements.publishedAt)),
      this.database.orm
        .select({ organizationId: organizationMembers.organizationId })
        .from(organizationMembers)
        .where(eq(organizationMembers.userId, userId)),
      this.database.orm
        .select({ biliUid: bilibiliBindings.biliUid })
        .from(bilibiliBindings)
        .where(eq(bilibiliBindings.userId, userId)),
      this.database.orm
        .select()
        .from(announcementReads)
        .where(eq(announcementReads.userId, userId)),
    ]);
    const uids = [...new Set(bindings.map((binding) => binding.biliUid))];
    const earned = uids.length
      ? await this.database.orm
          .select({ campaignId: entitlements.campaignId, creatorId: entitlements.creatorId })
          .from(entitlements)
          .where(inArray(entitlements.biliUid, uids))
      : [];
    const access = {
      campaignIds: new Set(earned.map((item) => item.campaignId)),
      creatorIds: new Set(earned.map((item) => item.creatorId)),
      organizationIds: new Set(memberships.map((item) => item.organizationId)),
    };
    const visible = active.filter((announcement) =>
      announcementVisibleToUser(
        {
          campaignId: announcement.campaignId,
          creatorId: announcement.creatorId,
          organizationId: announcement.organizationId,
          scope: announcement.scope as AnnouncementScope,
        },
        access,
      ),
    );
    const readById = new Map(reads.map((read) => [read.announcementId, read.readAt]));
    const mapped = visible.map((announcement) =>
      response(announcement, readById.get(announcement.id) ?? null),
    );
    return mapped.sort((left, right) => {
      const score = (item: (typeof mapped)[number]) =>
        (item.scope === 'PLATFORM' && item.pinned ? 100 : 0) +
        ((item.scope === 'CREATOR' || item.scope === 'CAMPAIGN') && !item.readAt ? 50 : 0) +
        (item.severity === 'CRITICAL' ? 30 : item.severity === 'WARNING' ? 10 : 0);
      return score(right) - score(left);
    });
  }

  public async markRead(userId: string, announcementId: string) {
    const visible = await this.listForUser(userId);
    if (!visible.some((announcement) => announcement.id === announcementId)) {
      throw new AppError('ANNOUNCEMENT_NOT_FOUND', 'Announcement not found.', 404);
    }
    const [read] = await this.database.orm
      .insert(announcementReads)
      .values({ announcementId, userId })
      .onConflictDoNothing()
      .returning();
    const [existing] = read
      ? [read]
      : await this.database.orm
          .select()
          .from(announcementReads)
          .where(
            and(
              eq(announcementReads.announcementId, announcementId),
              eq(announcementReads.userId, userId),
            ),
          )
          .limit(1);
    return { announcementId, readAt: existing!.readAt.toISOString() };
  }

  private async assertTarget(
    organizationId: string,
    input: Pick<CreateAnnouncementInput, 'campaignId' | 'creatorId' | 'scope'>,
    permittedCreatorIds: readonly string[],
  ) {
    if (input.scope === 'PLATFORM') {
      throw new AppError(
        'ANNOUNCEMENT_SCOPE_INVALID',
        'Platform announcements require platform administration.',
        400,
      );
    }
    if (input.scope === 'CREATOR') {
      const [creator] = await this.database.orm
        .select({ id: creators.id })
        .from(creators)
        .where(
          and(eq(creators.id, input.creatorId ?? ''), eq(creators.organizationId, organizationId)),
        )
        .limit(1);
      if (!creator) {
        throw new AppError(
          'ANNOUNCEMENT_TARGET_INVALID',
          'Creator does not belong to the organization.',
          400,
        );
      }
      if (permittedCreatorIds.length && !permittedCreatorIds.includes(creator.id)) {
        throw new AppError(
          'ANNOUNCEMENT_ACCESS_DENIED',
          'Announcement management access denied.',
          403,
        );
      }
    }
    if (input.scope === 'CAMPAIGN') {
      const [campaign] = await this.database.orm
        .select({ creatorId: giftCampaigns.creatorId, id: giftCampaigns.id })
        .from(giftCampaigns)
        .where(
          and(
            eq(giftCampaigns.id, input.campaignId ?? ''),
            eq(giftCampaigns.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!campaign) {
        throw new AppError(
          'ANNOUNCEMENT_TARGET_INVALID',
          'Campaign does not belong to the organization.',
          400,
        );
      }
      if (permittedCreatorIds.length && !permittedCreatorIds.includes(campaign.creatorId)) {
        throw new AppError(
          'ANNOUNCEMENT_ACCESS_DENIED',
          'Announcement management access denied.',
          403,
        );
      }
    }
    if (input.scope === 'ORGANIZATION' && permittedCreatorIds.length) {
      throw new AppError(
        'ANNOUNCEMENT_ACCESS_DENIED',
        'Creator-scoped members cannot publish organization-wide announcements.',
        403,
      );
    }
  }

  private validateCreate(input: CreateAnnouncementInput) {
    validateAnnouncementContent({
      body: input.body,
      expiresAt: input.expiresAt ?? null,
      publishedAt: input.publishedAt ?? null,
      title: input.title,
    });
    if (
      (input.scope === 'CREATOR' && !input.creatorId) ||
      (input.scope === 'CAMPAIGN' && !input.campaignId)
    ) {
      throw new AppError(
        'ANNOUNCEMENT_TARGET_INVALID',
        'Announcement scope requires its matching target.',
        400,
      );
    }
  }

  public async createOrganization(
    organizationId: string,
    input: CreateAnnouncementInput,
    context: RequestAuditContext,
    permittedCreatorIds: readonly string[] = [],
  ) {
    this.validateCreate(input);
    await this.assertTarget(organizationId, input, permittedCreatorIds);
    return this.database.orm.transaction(async (transaction) => {
      const [created] = await transaction
        .insert(announcements)
        .values({
          body: input.body.trim(),
          campaignId: input.scope === 'CAMPAIGN' ? input.campaignId : null,
          createdBy: context.actorUserId,
          creatorId: input.scope === 'CREATOR' ? input.creatorId : null,
          expiresAt: input.expiresAt ?? null,
          organizationId,
          pinned: input.pinned,
          publishedAt: input.publishedAt ?? null,
          scope: input.scope,
          severity: input.severity,
          title: input.title.trim(),
        })
        .returning();
      await this.recordMutation(null, created!, context, transaction);
      return response(created!);
    });
  }

  public async createPlatform(
    input: Omit<CreateAnnouncementInput, 'campaignId' | 'creatorId' | 'scope'>,
    context: RequestAuditContext,
  ) {
    const complete: CreateAnnouncementInput = { ...input, scope: 'PLATFORM' };
    this.validateCreate(complete);
    return this.database.orm.transaction(async (transaction) => {
      const [created] = await transaction
        .insert(announcements)
        .values({
          body: complete.body.trim(),
          createdBy: context.actorUserId,
          expiresAt: complete.expiresAt ?? null,
          pinned: complete.pinned,
          publishedAt: complete.publishedAt ?? null,
          scope: 'PLATFORM',
          severity: complete.severity,
          title: complete.title.trim(),
        })
        .returning();
      await this.recordMutation(null, created!, context, transaction);
      return response(created!);
    });
  }

  private async recordMutation(
    before: typeof announcements.$inferSelect | null,
    after: typeof announcements.$inferSelect,
    context: RequestAuditContext,
    executor: AppDatabase,
  ) {
    const published = before?.publishedAt === null && after.publishedAt !== null;
    await this.audit.record(
      {
        action: published
          ? 'announcement.published'
          : before
            ? 'announcement.updated'
            : 'announcement.created',
        actorUserId: context.actorUserId,
        afterSummary: {
          pinned: after.pinned,
          published: after.publishedAt !== null,
          scope: after.scope,
          severity: after.severity,
          version: after.version,
        },
        beforeSummary: before
          ? {
              pinned: before.pinned,
              published: before.publishedAt !== null,
              severity: before.severity,
              version: before.version,
            }
          : null,
        creatorId: after.creatorId,
        ipAddress: context.ipAddress ?? null,
        organizationId: after.organizationId,
        requestId: context.requestId ?? null,
        targetId: after.id,
        targetType: 'announcement',
      },
      executor,
    );
  }

  public async update(
    announcementId: string,
    input: UpdateAnnouncementInput,
    context: RequestAuditContext,
  ) {
    return this.database.orm.transaction(async (transaction) => {
      const [before] = await transaction
        .select()
        .from(announcements)
        .where(eq(announcements.id, announcementId))
        .limit(1)
        .for('update');
      if (!before) throw new AppError('ANNOUNCEMENT_NOT_FOUND', 'Announcement not found.', 404);
      if (before.version !== input.version) {
        throw new AppError(
          'ANNOUNCEMENT_VERSION_CONFLICT',
          'Announcement changed before this request.',
          409,
        );
      }
      const title = input.title ?? before.title;
      const body = input.body ?? before.body;
      const publishedAt = input.publishedAt === undefined ? before.publishedAt : input.publishedAt;
      const expiresAt = input.expiresAt === undefined ? before.expiresAt : input.expiresAt;
      validateAnnouncementContent({ body, expiresAt, publishedAt, title });
      const now = await this.databaseNow(transaction);
      const [updated] = await transaction
        .update(announcements)
        .set({
          body: body.trim(),
          expiresAt,
          pinned: input.pinned ?? before.pinned,
          publishedAt,
          severity: input.severity ?? before.severity,
          title: title.trim(),
          updatedAt: now,
          version: sql`${announcements.version} + 1`,
        })
        .where(eq(announcements.id, announcementId))
        .returning();
      await this.recordMutation(before, updated!, context, transaction);
      return response(updated!);
    });
  }

  public async listOrganization(
    organizationId: string,
    permittedCreatorIds: readonly string[] = [],
  ) {
    const rows = await this.database.orm
      .select()
      .from(announcements)
      .where(eq(announcements.organizationId, organizationId))
      .orderBy(desc(announcements.createdAt));
    if (!permittedCreatorIds.length) return rows.map((row) => response(row));
    const campaignIds = rows
      .map((row) => row.campaignId)
      .filter((campaignId): campaignId is string => campaignId !== null);
    const campaignRows = campaignIds.length
      ? await this.database.orm
          .select({ creatorId: giftCampaigns.creatorId, id: giftCampaigns.id })
          .from(giftCampaigns)
          .where(inArray(giftCampaigns.id, campaignIds))
      : [];
    const campaignCreators = new Map(
      campaignRows.map((campaign) => [campaign.id, campaign.creatorId]),
    );
    return rows
      .filter(
        (row) =>
          (row.creatorId !== null && permittedCreatorIds.includes(row.creatorId)) ||
          (row.campaignId !== null &&
            permittedCreatorIds.includes(campaignCreators.get(row.campaignId) ?? '')),
      )
      .map((row) => response(row));
  }

  public async listPlatform() {
    const rows = await this.database.orm
      .select()
      .from(announcements)
      .where(eq(announcements.scope, 'PLATFORM'))
      .orderBy(desc(announcements.createdAt));
    return rows.map((row) => response(row));
  }

  public async assertManagementAccess(session: AuthSession, announcementId: string) {
    const [announcement] = await this.database.orm
      .select()
      .from(announcements)
      .where(eq(announcements.id, announcementId))
      .limit(1);
    if (!announcement) throw new AppError('ANNOUNCEMENT_NOT_FOUND', 'Announcement not found.', 404);
    if (announcement.scope === 'PLATFORM') {
      if (session.user.platformRole !== 'PLATFORM_ADMIN') {
        throw new AppError(
          'PLATFORM_PERMISSION_DENIED',
          'Platform administrator access required.',
          403,
        );
      }
      return announcement;
    }
    const [membership] = await this.database.orm
      .select({ id: organizationMembers.id, role: organizationMembers.role })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, announcement.organizationId!),
          eq(organizationMembers.userId, session.user.id),
        ),
      )
      .limit(1);
    if (
      !membership ||
      !isOrganizationRole(membership.role) ||
      !hasOrganizationPermission(membership.role, 'announcement.manage')
    ) {
      throw new AppError(
        'ANNOUNCEMENT_ACCESS_DENIED',
        'Announcement management access denied.',
        403,
      );
    }
    const scopes = await this.database.orm
      .select({ creatorId: memberCreatorScopes.creatorId })
      .from(memberCreatorScopes)
      .where(eq(memberCreatorScopes.memberId, membership.id));
    if (
      announcement.creatorId &&
      scopes.length &&
      !scopes.some((scope) => scope.creatorId === announcement.creatorId)
    ) {
      throw new AppError(
        'ANNOUNCEMENT_ACCESS_DENIED',
        'Announcement management access denied.',
        403,
      );
    }
    if (announcement.campaignId && scopes.length) {
      const [campaign] = await this.database.orm
        .select({ creatorId: giftCampaigns.creatorId })
        .from(giftCampaigns)
        .where(eq(giftCampaigns.id, announcement.campaignId))
        .limit(1);
      if (!campaign || !scopes.some((scope) => scope.creatorId === campaign.creatorId)) {
        throw new AppError(
          'ANNOUNCEMENT_ACCESS_DENIED',
          'Announcement management access denied.',
          403,
        );
      }
    }
    if (announcement.scope === 'ORGANIZATION' && scopes.length) {
      throw new AppError(
        'ANNOUNCEMENT_ACCESS_DENIED',
        'Announcement management access denied.',
        403,
      );
    }
    return announcement;
  }
}
