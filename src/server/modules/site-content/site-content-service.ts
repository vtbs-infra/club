import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';

import { AppError } from '../../../shared/errors/app-error.js';
import {
  assertSitePageContent,
  defaultSitePageContent,
  type SiteAdminState,
  type SiteHomeResponse,
  type SitePageContent,
} from '../../../shared/site-content.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import {
  addresses,
  announcements,
  bilibiliBindings,
  creators,
  giftOrders,
  giftReleases,
  sitePages,
  sitePageVersions,
} from '../../infrastructure/db/schema/index.js';
import { AuditService, type RequestAuditContext } from '../audit/audit-service.js';

const HOME_SLUG = 'home';

function cloneDefault(): SitePageContent {
  return structuredClone(defaultSitePageContent);
}

function maskUid(uid: string): string {
  if (uid.length <= 5) return `${uid.slice(0, 1)}***${uid.slice(-1)}`;
  return `${uid.slice(0, 3)}****${uid.slice(-3)}`;
}

function serializeVersion(row: typeof sitePageVersions.$inferSelect) {
  return {
    createdAt: row.createdAt.toISOString(),
    createdByUserId: row.createdByUserId,
    id: row.id,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    version: row.version,
  };
}

export class SiteContentService {
  private readonly audit: AuditService;

  public constructor(
    private readonly database: DatabaseService,
    private readonly clock: Clock,
  ) {
    this.audit = new AuditService(database);
  }

  private async page() {
    const [page] = await this.database.orm
      .select()
      .from(sitePages)
      .where(eq(sitePages.slug, HOME_SLUG))
      .limit(1);
    return page ?? null;
  }

  private async visibleCreatorIds(userId: string, biliUid: string | null): Promise<string[]> {
    const condition = biliUid
      ? or(eq(giftOrders.userId, userId), eq(giftOrders.biliUid, biliUid))
      : eq(giftOrders.userId, userId);
    const rows = await this.database.orm
      .selectDistinct({ creatorId: giftOrders.creatorId })
      .from(giftOrders)
      .where(condition);
    return rows.map((row) => row.creatorId);
  }

  public async getPublic(userId: string | null): Promise<SiteHomeResponse> {
    const now = this.clock.now();
    const page = await this.page();
    const [published] = page?.publishedVersionId
      ? await this.database.orm
          .select()
          .from(sitePageVersions)
          .where(eq(sitePageVersions.id, page.publishedVersionId))
          .limit(1)
      : [];

    const campaignRows = await this.database.orm
      .select({
        creatorName: creators.displayName,
        release: giftReleases,
      })
      .from(giftReleases)
      .innerJoin(creators, eq(creators.id, giftReleases.creatorId))
      .where(
        and(
          eq(giftReleases.status, 'PUBLISHED'),
          lte(giftReleases.claimStartAt, now),
          gt(giftReleases.claimDeadlineAt, now),
        ),
      )
      .orderBy(asc(giftReleases.claimDeadlineAt))
      .limit(6);

    const binding = userId
      ? (
          await this.database.orm
            .select({
              biliDisplayName: bilibiliBindings.biliDisplayName,
              biliUid: bilibiliBindings.biliUid,
            })
            .from(bilibiliBindings)
            .where(and(eq(bilibiliBindings.userId, userId), isNull(bilibiliBindings.unboundAt)))
            .limit(1)
        )[0]
      : null;
    const creatorIds = userId ? await this.visibleCreatorIds(userId, binding?.biliUid ?? null) : [];
    const announcementVisibility =
      creatorIds.length === 0
        ? eq(announcements.scope, 'PLATFORM')
        : or(
            eq(announcements.scope, 'PLATFORM'),
            and(eq(announcements.scope, 'CREATOR'), inArray(announcements.creatorId, creatorIds)),
          );
    const announcementRows = await this.database.orm
      .select()
      .from(announcements)
      .where(
        and(
          announcementVisibility,
          lte(announcements.publishedAt, now),
          or(isNull(announcements.expiresAt), gt(announcements.expiresAt, now)),
        ),
      )
      .orderBy(desc(announcements.pinned), desc(announcements.publishedAt))
      .limit(4);

    let user: SiteHomeResponse['user'] = null;
    if (userId) {
      const [address] = await this.database.orm
        .select({ id: addresses.id })
        .from(addresses)
        .where(eq(addresses.userId, userId))
        .orderBy(desc(addresses.isDefault), desc(addresses.updatedAt))
        .limit(1);
      const orderAccess = binding
        ? or(eq(giftOrders.userId, userId), eq(giftOrders.biliUid, binding.biliUid))
        : eq(giftOrders.userId, userId);
      const [pendingGift] = await this.database.orm
        .select({
          claimDeadlineAt: giftReleases.claimDeadlineAt,
          orderId: giftOrders.id,
          title: giftReleases.title,
        })
        .from(giftOrders)
        .innerJoin(giftReleases, eq(giftReleases.id, giftOrders.giftReleaseId))
        .where(and(orderAccess, eq(giftOrders.status, 'CLAIMABLE')))
        .orderBy(asc(giftReleases.claimDeadlineAt))
        .limit(1);
      const [latestDelivery] = await this.database.orm
        .select({
          orderId: giftOrders.id,
          status: giftOrders.status,
          title: giftReleases.title,
        })
        .from(giftOrders)
        .innerJoin(giftReleases, eq(giftReleases.id, giftOrders.giftReleaseId))
        .where(
          and(
            orderAccess,
            inArray(giftOrders.status, ['SUBMITTED', 'PROCESSING', 'SHIPPED', 'COMPLETED']),
          ),
        )
        .orderBy(desc(giftOrders.updatedAt))
        .limit(1);
      user = {
        addressReady: Boolean(address),
        binding: binding
          ? {
              displayName: binding.biliDisplayName,
              maskedUid: maskUid(binding.biliUid),
            }
          : null,
        latestDelivery: latestDelivery ?? null,
        pendingGift: pendingGift
          ? {
              ...pendingGift,
              claimDeadlineAt: pendingGift.claimDeadlineAt.toISOString(),
            }
          : null,
      };
    }

    return {
      announcements: announcementRows.map((announcement) => ({
        body: announcement.body,
        id: announcement.id,
        pinned: announcement.pinned,
        publishedAt: announcement.publishedAt!.toISOString(),
        severity: announcement.severity as 'CRITICAL' | 'INFO' | 'WARNING',
        title: announcement.title,
      })),
      campaigns: campaignRows.map(({ creatorName, release }) => ({
        claimDeadlineAt: release.claimDeadlineAt.toISOString(),
        claimStartAt: release.claimStartAt.toISOString(),
        coverImageUrl: release.coverObjectKey ? `/api/v1/gift-releases/${release.id}/cover` : null,
        creatorName,
        description: release.description,
        eligibilityMonth: release.eligibilityMonth,
        id: release.id,
        title: release.title,
      })),
      content: published?.contentJson ?? cloneDefault(),
      user,
    };
  }

  public async getAdmin(): Promise<SiteAdminState> {
    const page = await this.page();
    if (!page) {
      return {
        draft: { content: cloneDefault(), id: null, version: 0 },
        published: { content: cloneDefault(), id: null, version: 0 },
        versions: [],
      };
    }
    const versions = await this.database.orm
      .select()
      .from(sitePageVersions)
      .where(eq(sitePageVersions.pageId, page.id))
      .orderBy(desc(sitePageVersions.version))
      .limit(50);
    const draft = versions.find((version) => version.id === page.draftVersionId);
    const published = versions.find((version) => version.id === page.publishedVersionId);
    return {
      draft: {
        content: draft?.contentJson ?? published?.contentJson ?? cloneDefault(),
        id: draft?.id ?? null,
        version: draft?.version ?? published?.version ?? 0,
      },
      published: {
        content: published?.contentJson ?? cloneDefault(),
        id: published?.id ?? null,
        version: published?.version ?? 0,
      },
      versions: versions.map(serializeVersion),
    };
  }

  public async saveDraft(
    input: RequestAuditContext & {
      readonly content: SitePageContent;
      readonly expectedDraftId: string | null;
    },
  ): Promise<SiteAdminState> {
    try {
      assertSitePageContent(input.content);
    } catch {
      throw new AppError(
        'SITE_CONTENT_INVALID',
        'Homepage content is invalid or contains an unsafe link.',
        400,
      );
    }
    await this.database.orm.transaction(async (transaction) => {
      let [page] = await transaction
        .select()
        .from(sitePages)
        .where(eq(sitePages.slug, HOME_SLUG))
        .limit(1)
        .for('update');
      if (!page) {
        [page] = await transaction.insert(sitePages).values({ slug: HOME_SLUG }).returning();
      }
      if (!page) throw new Error('Homepage insert returned no row.');
      if (page.draftVersionId !== input.expectedDraftId) {
        throw new AppError(
          'SITE_CONTENT_VERSION_CONFLICT',
          'Homepage content changed in another administrator session. Refresh and try again.',
          409,
        );
      }
      const [next] = await transaction
        .select({ value: sql<number>`coalesce(max(${sitePageVersions.version}), 0) + 1` })
        .from(sitePageVersions)
        .where(eq(sitePageVersions.pageId, page.id));
      const [version] = await transaction
        .insert(sitePageVersions)
        .values({
          contentJson: structuredClone(input.content),
          createdByUserId: input.actorUserId,
          pageId: page.id,
          version: Number(next?.value ?? 1),
        })
        .returning();
      if (!version) throw new Error('Homepage version insert returned no row.');
      await transaction
        .update(sitePages)
        .set({ draftVersionId: version.id, updatedAt: this.clock.now() })
        .where(eq(sitePages.id, page.id));
      await this.audit.record(
        {
          action: 'site-home.draft-saved',
          actorUserId: input.actorUserId,
          afterSummary: { blockCount: input.content.blocks.length, version: version.version },
          beforeSummary: { draftVersionId: page.draftVersionId },
          ipAddress: input.ipAddress,
          requestId: input.requestId,
          targetId: page.id,
          targetType: 'site-page',
        },
        transaction,
      );
    });
    return this.getAdmin();
  }

  public async publish(
    input: RequestAuditContext & { readonly expectedDraftId: string },
  ): Promise<SiteAdminState> {
    await this.database.orm.transaction(async (transaction) => {
      const [page] = await transaction
        .select()
        .from(sitePages)
        .where(eq(sitePages.slug, HOME_SLUG))
        .limit(1)
        .for('update');
      if (!page?.draftVersionId) {
        throw new AppError('SITE_CONTENT_DRAFT_REQUIRED', 'Save a homepage draft first.', 409);
      }
      if (page.draftVersionId !== input.expectedDraftId) {
        throw new AppError(
          'SITE_CONTENT_VERSION_CONFLICT',
          'Homepage content changed in another administrator session. Refresh and try again.',
          409,
        );
      }
      const now = this.clock.now();
      await transaction
        .update(sitePageVersions)
        .set({ publishedAt: now })
        .where(eq(sitePageVersions.id, page.draftVersionId));
      await transaction
        .update(sitePages)
        .set({ publishedVersionId: page.draftVersionId, updatedAt: now })
        .where(eq(sitePages.id, page.id));
      await this.audit.record(
        {
          action: 'site-home.published',
          actorUserId: input.actorUserId,
          afterSummary: { publishedVersionId: page.draftVersionId },
          beforeSummary: { publishedVersionId: page.publishedVersionId },
          ipAddress: input.ipAddress,
          requestId: input.requestId,
          targetId: page.id,
          targetType: 'site-page',
        },
        transaction,
      );
    });
    return this.getAdmin();
  }

  public async restore(
    input: RequestAuditContext & {
      readonly expectedDraftId: string | null;
      readonly versionId: string;
    },
  ): Promise<SiteAdminState> {
    await this.database.orm.transaction(async (transaction) => {
      const [page] = await transaction
        .select()
        .from(sitePages)
        .where(eq(sitePages.slug, HOME_SLUG))
        .limit(1)
        .for('update');
      if (!page) throw new AppError('SITE_CONTENT_NOT_FOUND', 'Homepage content not found.', 404);
      if (page.draftVersionId !== input.expectedDraftId) {
        throw new AppError(
          'SITE_CONTENT_VERSION_CONFLICT',
          'Homepage content changed in another administrator session. Refresh and try again.',
          409,
        );
      }
      const [source] = await transaction
        .select()
        .from(sitePageVersions)
        .where(and(eq(sitePageVersions.id, input.versionId), eq(sitePageVersions.pageId, page.id)))
        .limit(1);
      if (!source) {
        throw new AppError('SITE_CONTENT_VERSION_NOT_FOUND', 'Homepage version not found.', 404);
      }
      const [next] = await transaction
        .select({ value: sql<number>`coalesce(max(${sitePageVersions.version}), 0) + 1` })
        .from(sitePageVersions)
        .where(eq(sitePageVersions.pageId, page.id));
      const [restored] = await transaction
        .insert(sitePageVersions)
        .values({
          contentJson: source.contentJson,
          createdByUserId: input.actorUserId,
          pageId: page.id,
          version: Number(next?.value ?? 1),
        })
        .returning();
      if (!restored) throw new Error('Restored homepage version insert returned no row.');
      await transaction
        .update(sitePages)
        .set({ draftVersionId: restored.id, updatedAt: this.clock.now() })
        .where(eq(sitePages.id, page.id));
      await this.audit.record(
        {
          action: 'site-home.version-restored',
          actorUserId: input.actorUserId,
          afterSummary: { restoredFrom: source.version, version: restored.version },
          beforeSummary: { draftVersionId: page.draftVersionId },
          ipAddress: input.ipAddress,
          requestId: input.requestId,
          targetId: page.id,
          targetType: 'site-page',
        },
        transaction,
      );
    });
    return this.getAdmin();
  }
}
