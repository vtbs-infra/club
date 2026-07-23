import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { AppError } from '../../../shared/errors/app-error.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { AppDatabase, DatabaseService } from '../../infrastructure/db/database.js';
import {
  bilibiliBindings,
  claims,
  creators,
  entitlements,
  giftCampaigns,
  giftPackageItems,
  giftPackages,
  giftTierRules,
  memberCreatorScopes,
  organizationMembers,
  snapshotMembers,
  snapshotRuns,
  type CampaignClaimField,
} from '../../infrastructure/db/schema.js';
import { AuditService } from '../audit/audit-service.js';
import type { AuthSession } from '../auth/auth.js';
import { projectGiftState, type ClaimStatus } from '../claims/claim-domain.js';
import {
  selectEarnedPackageIds,
  validateClaimFieldSchema,
  type FulfillmentMode,
  type GuardTier,
} from './campaign-domain.js';

export interface RequestAuditContext {
  readonly actorUserId: string;
  readonly ipAddress?: string;
  readonly requestId?: string;
}

export interface CampaignCompositionInput {
  readonly packages: readonly {
    readonly description: string;
    readonly items: readonly {
      readonly description: string;
      readonly name: string;
      readonly quantity: number;
    }[];
    readonly key: string;
    readonly name: string;
  }[];
  readonly tierRules: readonly { readonly packageKey: string; readonly tier: GuardTier }[];
}

export interface CreateCampaignInput {
  readonly claimDeadlineAt: Date;
  readonly claimFormSchema: unknown;
  readonly claimStartAt: Date;
  readonly creatorId: string;
  readonly description: string;
  readonly fulfillmentMode: FulfillmentMode;
  readonly periodStart: string;
  readonly title: string;
}

export interface UpdateCampaignInput {
  readonly claimDeadlineAt?: Date | undefined;
  readonly claimFormSchema?: unknown;
  readonly claimStartAt?: Date | undefined;
  readonly composition?: CampaignCompositionInput | undefined;
  readonly description?: string | undefined;
  readonly fulfillmentMode?: FulfillmentMode | undefined;
  readonly periodStart?: string | undefined;
  readonly title?: string | undefined;
}

function validateWindow(start: Date, deadline: Date) {
  if (deadline <= start) {
    throw new AppError('CAMPAIGN_WINDOW_INVALID', 'Claim deadline must be after claim start.', 400);
  }
}

function validateComposition(composition: CampaignCompositionInput) {
  if (composition.packages.length < 1 || composition.packages.length > 20) {
    throw new AppError('CAMPAIGN_PACKAGES_INVALID', 'A campaign needs 1 to 20 packages.', 400);
  }
  const keys = new Set(composition.packages.map((giftPackage) => giftPackage.key));
  const names = new Set(composition.packages.map((giftPackage) => giftPackage.name.trim()));
  if (
    keys.size !== composition.packages.length ||
    names.size !== composition.packages.length ||
    composition.packages.some(
      (giftPackage) =>
        !/^[a-zA-Z0-9_-]{1,40}$/.test(giftPackage.key) ||
        giftPackage.name.trim().length < 1 ||
        giftPackage.name.length > 100 ||
        giftPackage.items.length < 1 ||
        giftPackage.items.length > 50 ||
        giftPackage.items.some(
          (item) => item.name.trim().length < 1 || item.name.length > 120 || item.quantity < 1,
        ),
    )
  ) {
    throw new AppError('CAMPAIGN_PACKAGES_INVALID', 'Package contents are invalid.', 400);
  }
  const tiers = new Set(composition.tierRules.map((rule) => rule.tier));
  if (
    composition.tierRules.length < 1 ||
    tiers.size !== composition.tierRules.length ||
    composition.tierRules.some((rule) => !keys.has(rule.packageKey))
  ) {
    throw new AppError('CAMPAIGN_TIER_RULES_INVALID', 'Tier rules are invalid.', 400);
  }
}

export class CampaignService {
  private readonly audit: AuditService;

  public constructor(
    private readonly database: DatabaseService,
    private readonly clock: Clock,
  ) {
    this.audit = new AuditService(database);
  }

  private async replaceComposition(
    campaignId: string,
    composition: CampaignCompositionInput,
    executor: AppDatabase,
  ) {
    validateComposition(composition);
    const existingPackages = await executor
      .select({ id: giftPackages.id })
      .from(giftPackages)
      .where(eq(giftPackages.campaignId, campaignId));
    if (existingPackages.length > 0) {
      const ids = existingPackages.map((giftPackage) => giftPackage.id);
      await executor.delete(giftTierRules).where(eq(giftTierRules.campaignId, campaignId));
      await executor.delete(giftPackageItems).where(inArray(giftPackageItems.giftPackageId, ids));
      await executor.delete(giftPackages).where(eq(giftPackages.campaignId, campaignId));
    }
    const packageIds = new Map<string, string>();
    for (let packageIndex = 0; packageIndex < composition.packages.length; packageIndex += 1) {
      const giftPackage = composition.packages[packageIndex]!;
      const [inserted] = await executor
        .insert(giftPackages)
        .values({
          campaignId,
          description: giftPackage.description,
          name: giftPackage.name.trim(),
          sortOrder: packageIndex,
        })
        .returning({ id: giftPackages.id });
      if (!inserted) throw new Error('Package insert returned no row.');
      packageIds.set(giftPackage.key, inserted.id);
      await executor.insert(giftPackageItems).values(
        giftPackage.items.map((item, itemIndex) => ({
          description: item.description,
          giftPackageId: inserted.id,
          name: item.name.trim(),
          quantity: item.quantity,
          sortOrder: itemIndex,
        })),
      );
    }
    await executor.insert(giftTierRules).values(
      composition.tierRules.map((rule) => ({
        campaignId,
        giftPackageId: packageIds.get(rule.packageKey)!,
        tier: rule.tier,
      })),
    );
  }

  public async create(
    organizationId: string,
    input: CreateCampaignInput,
    context: RequestAuditContext,
  ) {
    if (!validateClaimFieldSchema(input.claimFormSchema)) {
      throw new AppError('CAMPAIGN_CLAIM_SCHEMA_INVALID', 'Claim-field schema is invalid.', 400);
    }
    validateWindow(input.claimStartAt, input.claimDeadlineAt);
    const [creator] = await this.database.orm
      .select({ id: creators.id })
      .from(creators)
      .where(and(eq(creators.id, input.creatorId), eq(creators.organizationId, organizationId)))
      .limit(1);
    if (!creator) throw new AppError('CREATOR_NOT_FOUND', 'Creator not found.', 404);
    return this.database.orm.transaction(async (transaction) => {
      const [campaign] = await transaction
        .insert(giftCampaigns)
        .values({
          claimDeadlineAt: input.claimDeadlineAt,
          claimFormSchema: input.claimFormSchema as readonly CampaignClaimField[],
          claimStartAt: input.claimStartAt,
          createdBy: context.actorUserId,
          creatorId: input.creatorId,
          description: input.description,
          fulfillmentMode: input.fulfillmentMode,
          organizationId,
          periodStart: input.periodStart,
          title: input.title.trim(),
        })
        .returning();
      if (!campaign) throw new Error('Campaign insert returned no row.');
      await this.audit.record(
        {
          action: 'campaign.created',
          actorUserId: context.actorUserId,
          afterSummary: { periodStart: campaign.periodStart, status: campaign.status },
          creatorId: campaign.creatorId,
          ipAddress: context.ipAddress ?? null,
          organizationId,
          requestId: context.requestId ?? null,
          targetId: campaign.id,
          targetType: 'gift-campaign',
        },
        transaction,
      );
      return campaign;
    });
  }

  public async update(
    campaignId: string,
    input: UpdateCampaignInput,
    context: RequestAuditContext,
  ) {
    return this.database.orm.transaction(async (transaction) => {
      const [campaign] = await transaction
        .select()
        .from(giftCampaigns)
        .where(eq(giftCampaigns.id, campaignId))
        .limit(1)
        .for('update');
      if (!campaign) throw new AppError('CAMPAIGN_NOT_FOUND', 'Campaign not found.', 404);
      const published = campaign.status !== 'DRAFT';
      if (
        published &&
        (input.periodStart !== undefined ||
          input.claimStartAt !== undefined ||
          input.fulfillmentMode !== undefined ||
          input.claimFormSchema !== undefined ||
          input.composition !== undefined)
      ) {
        throw new AppError(
          'CAMPAIGN_PUBLISHED_IMMUTABLE',
          'Published campaign rules are frozen.',
          409,
        );
      }
      if (input.claimFormSchema !== undefined && !validateClaimFieldSchema(input.claimFormSchema)) {
        throw new AppError('CAMPAIGN_CLAIM_SCHEMA_INVALID', 'Claim-field schema is invalid.', 400);
      }
      const claimStartAt = input.claimStartAt ?? campaign.claimStartAt;
      const claimDeadlineAt = input.claimDeadlineAt ?? campaign.claimDeadlineAt;
      validateWindow(claimStartAt, claimDeadlineAt);
      if (published && claimDeadlineAt < campaign.claimDeadlineAt) {
        throw new AppError(
          'CAMPAIGN_DEADLINE_SHORTENING_FORBIDDEN',
          'A published claim deadline may only be extended.',
          409,
        );
      }
      const [updated] = await transaction
        .update(giftCampaigns)
        .set({
          ...(input.claimDeadlineAt === undefined ? {} : { claimDeadlineAt }),
          ...(input.claimFormSchema === undefined
            ? {}
            : { claimFormSchema: input.claimFormSchema }),
          ...(input.claimStartAt === undefined ? {} : { claimStartAt }),
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.fulfillmentMode === undefined
            ? {}
            : { fulfillmentMode: input.fulfillmentMode }),
          ...(input.periodStart === undefined ? {} : { periodStart: input.periodStart }),
          ...(input.title === undefined ? {} : { title: input.title.trim() }),
          updatedAt: this.clock.now(),
        })
        .where(eq(giftCampaigns.id, campaign.id))
        .returning();
      if (input.composition) {
        await this.replaceComposition(campaign.id, input.composition, transaction);
      }
      await this.audit.record(
        {
          action: published ? 'campaign.display-corrected' : 'campaign.updated',
          actorUserId: context.actorUserId,
          afterSummary: {
            claimDeadlineAt: updated?.claimDeadlineAt.toISOString(),
            description: updated?.description,
            title: updated?.title,
          },
          beforeSummary: {
            claimDeadlineAt: campaign.claimDeadlineAt.toISOString(),
            description: campaign.description,
            title: campaign.title,
          },
          creatorId: campaign.creatorId,
          ipAddress: context.ipAddress ?? null,
          organizationId: campaign.organizationId,
          requestId: context.requestId ?? null,
          targetId: campaign.id,
          targetType: 'gift-campaign',
        },
        transaction,
      );
      return this.getDetail(campaign.id, transaction);
    });
  }

  public async publish(campaignId: string, context: RequestAuditContext) {
    return this.database.orm.transaction(async (transaction) => {
      const [campaign] = await transaction
        .select()
        .from(giftCampaigns)
        .where(eq(giftCampaigns.id, campaignId))
        .limit(1)
        .for('update');
      if (!campaign || campaign.status !== 'DRAFT') {
        throw new AppError('CAMPAIGN_NOT_PUBLISHABLE', 'Campaign is not a publishable draft.', 409);
      }
      const [packageCount] = await transaction
        .select({ value: count() })
        .from(giftPackages)
        .where(eq(giftPackages.campaignId, campaign.id));
      const [ruleCount] = await transaction
        .select({ value: count() })
        .from(giftTierRules)
        .where(eq(giftTierRules.campaignId, campaign.id));
      if ((packageCount?.value ?? 0) < 1 || (ruleCount?.value ?? 0) < 1) {
        throw new AppError(
          'CAMPAIGN_INCOMPLETE',
          'Add packages and tier rules before publishing.',
          409,
        );
      }
      const now = this.clock.now();
      await transaction
        .update(giftCampaigns)
        .set({ publishedAt: now, status: 'PUBLISHED', updatedAt: now })
        .where(eq(giftCampaigns.id, campaign.id));
      const created = await this.reconcileCampaign(campaign.id, transaction);
      await this.audit.record(
        {
          action: 'campaign.published',
          actorUserId: context.actorUserId,
          afterSummary: { entitlementsCreated: created, status: 'PUBLISHED' },
          creatorId: campaign.creatorId,
          ipAddress: context.ipAddress ?? null,
          organizationId: campaign.organizationId,
          requestId: context.requestId ?? null,
          targetId: campaign.id,
          targetType: 'gift-campaign',
        },
        transaction,
      );
      return this.getDetail(campaign.id, transaction);
    });
  }

  public async transition(
    campaignId: string,
    target: 'CLOSED' | 'ARCHIVED',
    context: RequestAuditContext,
  ) {
    const expected = target === 'CLOSED' ? 'PUBLISHED' : 'CLOSED';
    return this.database.orm.transaction(async (transaction) => {
      const [current] = await transaction
        .select()
        .from(giftCampaigns)
        .where(eq(giftCampaigns.id, campaignId))
        .limit(1)
        .for('update');
      if (!current || current.status !== expected) {
        throw new AppError('CAMPAIGN_TRANSITION_INVALID', 'Campaign state is invalid.', 409);
      }
      const now = this.clock.now();
      const [campaign] = await transaction
        .update(giftCampaigns)
        .set({
          ...(target === 'CLOSED' ? { closedAt: now } : {}),
          status: target,
          updatedAt: now,
        })
        .where(eq(giftCampaigns.id, campaignId))
        .returning();
      await this.audit.record(
        {
          action: `campaign.${target.toLowerCase()}`,
          actorUserId: context.actorUserId,
          afterSummary: { status: target },
          beforeSummary: { status: expected },
          creatorId: current.creatorId,
          ipAddress: context.ipAddress ?? null,
          organizationId: current.organizationId,
          requestId: context.requestId ?? null,
          targetId: current.id,
          targetType: 'gift-campaign',
        },
        transaction,
      );
      return this.getDetail(campaign!.id, transaction);
    });
  }

  public async reconcileCampaign(campaignId: string, executor: AppDatabase = this.database.orm) {
    const [campaign] = await executor
      .select()
      .from(giftCampaigns)
      .where(
        and(
          eq(giftCampaigns.id, campaignId),
          inArray(giftCampaigns.status, ['PUBLISHED', 'CLOSED']),
        ),
      )
      .limit(1);
    if (!campaign) return 0;
    const [run] = await executor
      .select({ id: snapshotRuns.id })
      .from(snapshotRuns)
      .where(
        and(
          eq(snapshotRuns.creatorId, campaign.creatorId),
          eq(snapshotRuns.periodStart, campaign.periodStart),
          eq(snapshotRuns.status, 'FINALIZED'),
        ),
      )
      .limit(1);
    if (!run) return 0;
    const [members, rules] = await Promise.all([
      executor.select().from(snapshotMembers).where(eq(snapshotMembers.snapshotRunId, run.id)),
      executor
        .select({ giftPackageId: giftTierRules.giftPackageId, tier: giftTierRules.tier })
        .from(giftTierRules)
        .where(eq(giftTierRules.campaignId, campaign.id)),
    ]);
    const values = members.flatMap((member) =>
      selectEarnedPackageIds(
        member.tier as GuardTier,
        campaign.fulfillmentMode as FulfillmentMode,
        rules as readonly { giftPackageId: string; tier: GuardTier }[],
      ).map((giftPackageId) => ({
        biliUid: member.biliUid,
        campaignId: campaign.id,
        creatorId: campaign.creatorId,
        giftPackageId,
        organizationId: campaign.organizationId,
        snapshotMemberId: member.id,
        tier: member.tier,
      })),
    );
    if (values.length === 0) return 0;
    const inserted = await executor
      .insert(entitlements)
      .values(values)
      .onConflictDoNothing()
      .returning({
        id: entitlements.id,
      });
    return inserted.length;
  }

  public async reconcileSnapshot(runId: string, executor: AppDatabase = this.database.orm) {
    const [run] = await executor
      .select({ creatorId: snapshotRuns.creatorId, periodStart: snapshotRuns.periodStart })
      .from(snapshotRuns)
      .where(and(eq(snapshotRuns.id, runId), eq(snapshotRuns.status, 'FINALIZED')))
      .limit(1);
    if (!run) return 0;
    const campaigns = await executor
      .select({ id: giftCampaigns.id })
      .from(giftCampaigns)
      .where(
        and(
          eq(giftCampaigns.creatorId, run.creatorId),
          eq(giftCampaigns.periodStart, run.periodStart),
          inArray(giftCampaigns.status, ['PUBLISHED', 'CLOSED']),
        ),
      );
    let created = 0;
    for (const campaign of campaigns)
      created += await this.reconcileCampaign(campaign.id, executor);
    return created;
  }

  public async list(organizationId: string, allowedCreatorIds?: readonly string[]) {
    const condition =
      allowedCreatorIds && allowedCreatorIds.length > 0
        ? and(
            eq(giftCampaigns.organizationId, organizationId),
            inArray(giftCampaigns.creatorId, [...allowedCreatorIds]),
          )
        : eq(giftCampaigns.organizationId, organizationId);
    const campaigns = await this.database.orm
      .select()
      .from(giftCampaigns)
      .where(condition)
      .orderBy(desc(giftCampaigns.periodStart));
    const counts = await this.database.orm
      .select({ campaignId: entitlements.campaignId, value: count() })
      .from(entitlements)
      .where(eq(entitlements.organizationId, organizationId))
      .groupBy(entitlements.campaignId);
    const byCampaign = new Map(counts.map((row) => [row.campaignId, row.value]));
    return campaigns.map((campaign) => ({
      ...campaign,
      entitlementCount: byCampaign.get(campaign.id) ?? 0,
    }));
  }

  public async getDetail(campaignId: string, executor: AppDatabase = this.database.orm) {
    const [campaign] = await executor
      .select()
      .from(giftCampaigns)
      .where(eq(giftCampaigns.id, campaignId))
      .limit(1);
    if (!campaign) throw new AppError('CAMPAIGN_NOT_FOUND', 'Campaign not found.', 404);
    const [packages, rules, progress] = await Promise.all([
      executor
        .select()
        .from(giftPackages)
        .where(eq(giftPackages.campaignId, campaign.id))
        .orderBy(asc(giftPackages.sortOrder)),
      executor.select().from(giftTierRules).where(eq(giftTierRules.campaignId, campaign.id)),
      executor
        .select({ revokedAt: entitlements.revokedAt })
        .from(entitlements)
        .where(eq(entitlements.campaignId, campaign.id)),
    ]);
    const items =
      packages.length === 0
        ? []
        : await executor
            .select()
            .from(giftPackageItems)
            .where(
              inArray(
                giftPackageItems.giftPackageId,
                packages.map((giftPackage) => giftPackage.id),
              ),
            )
            .orderBy(asc(giftPackageItems.sortOrder));
    return {
      ...campaign,
      packages: packages.map((giftPackage) => ({
        ...giftPackage,
        items: items.filter((item) => item.giftPackageId === giftPackage.id),
      })),
      progress: {
        active: progress.filter((item) => item.revokedAt === null).length,
        revoked: progress.filter((item) => item.revokedAt !== null).length,
        total: progress.length,
      },
      tierRules: rules,
    };
  }

  public async listForUser(userId: string) {
    const [rows, userClaims, databaseTime] = await Promise.all([
      this.database.orm
        .select({
          campaign: giftCampaigns,
          entitlement: entitlements,
          giftPackage: giftPackages,
        })
        .from(bilibiliBindings)
        .innerJoin(
          entitlements,
          and(
            eq(entitlements.biliUid, bilibiliBindings.biliUid),
            isNull(bilibiliBindings.unboundAt),
          ),
        )
        .innerJoin(giftCampaigns, eq(giftCampaigns.id, entitlements.campaignId))
        .innerJoin(giftPackages, eq(giftPackages.id, entitlements.giftPackageId))
        .where(eq(bilibiliBindings.userId, userId))
        .orderBy(desc(giftCampaigns.periodStart), asc(giftPackages.sortOrder)),
      this.database.orm.select().from(claims).where(eq(claims.userId, userId)),
      this.database.orm.execute<{ value: Date | string }>(sql`select now() as value`),
    ]);
    const grouped = new Map<
      string,
      { campaign: (typeof rows)[number]['campaign']; entitlements: unknown[] }
    >();
    for (const row of rows) {
      const group = grouped.get(row.campaign.id) ?? { campaign: row.campaign, entitlements: [] };
      group.entitlements.push({ ...row.entitlement, giftPackage: row.giftPackage });
      grouped.set(row.campaign.id, group);
    }
    return [...grouped.values()].map((group) => {
      const claim = userClaims.find(
        (candidate) =>
          candidate.campaignId === group.campaign.id &&
          candidate.biliUid ===
            (group.entitlements[0] as { readonly biliUid: string } | undefined)?.biliUid,
      );
      return {
        ...group,
        claim: claim ? { id: claim.id, status: claim.status, version: claim.version } : null,
        displayState: projectGiftState({
          claimStatus: (claim?.status as ClaimStatus | undefined) ?? null,
          deadlineAt: group.campaign.claimDeadlineAt,
          hasRevokedEntitlement: group.entitlements.some(
            (item) => (item as { readonly revokedAt: Date | null }).revokedAt !== null,
          ),
          now:
            databaseTime[0]!.value instanceof Date
              ? databaseTime[0]!.value
              : new Date(databaseTime[0]!.value),
        }),
      };
    });
  }

  public async getForUser(userId: string, campaignId: string) {
    const campaign = (await this.listForUser(userId)).find(
      (candidate) => candidate.campaign.id === campaignId,
    );
    if (!campaign) {
      throw new AppError(
        'RECIPIENT_CAMPAIGN_NOT_FOUND',
        'No gift campaign matches the active Bilibili binding.',
        404,
      );
    }
    return campaign;
  }

  public async revoke(entitlementId: string, reason: string, context: RequestAuditContext) {
    if (reason.trim().length < 3) {
      throw new AppError(
        'ENTITLEMENT_REVOKE_REASON_REQUIRED',
        'A revocation reason is required.',
        400,
      );
    }
    return this.database.orm.transaction(async (transaction) => {
      const [entitlement] = await transaction
        .select()
        .from(entitlements)
        .where(eq(entitlements.id, entitlementId))
        .limit(1)
        .for('update');
      if (!entitlement) throw new AppError('ENTITLEMENT_NOT_FOUND', 'Entitlement not found.', 404);
      if (entitlement.revokedAt) {
        throw new AppError('ENTITLEMENT_ALREADY_REVOKED', 'Entitlement is already revoked.', 409);
      }
      const now = this.clock.now();
      const [updated] = await transaction
        .update(entitlements)
        .set({ revokeReason: reason.trim(), revokedAt: now, revokedBy: context.actorUserId })
        .where(eq(entitlements.id, entitlement.id))
        .returning();
      await this.audit.record(
        {
          action: 'entitlement.revoked',
          actorUserId: context.actorUserId,
          afterSummary: { revokedAt: now.toISOString() },
          creatorId: entitlement.creatorId,
          ipAddress: context.ipAddress ?? null,
          organizationId: entitlement.organizationId,
          reason: reason.trim(),
          requestId: context.requestId ?? null,
          targetId: entitlement.id,
          targetType: 'entitlement',
        },
        transaction,
      );
      return updated;
    });
  }

  public async assertOrganizationAccess(
    session: AuthSession,
    organizationId: string,
    mode: 'manage' | 'read',
  ) {
    if (session.user.platformRole === 'PLATFORM_ADMIN') return { creatorIds: [] as string[] };
    const [membership] = await this.database.orm
      .select({ id: organizationMembers.id, role: organizationMembers.role })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.userId, session.user.id),
        ),
      )
      .limit(1);
    const allowed =
      membership && (mode === 'read' || ['OWNER', 'ADMIN', 'OPERATOR'].includes(membership.role));
    if (!allowed) throw new AppError('CAMPAIGN_ACCESS_DENIED', 'Campaign access denied.', 403);
    const scopes = await this.database.orm
      .select({ creatorId: memberCreatorScopes.creatorId })
      .from(memberCreatorScopes)
      .where(eq(memberCreatorScopes.memberId, membership.id));
    return { creatorIds: scopes.map((scope) => scope.creatorId) };
  }

  public async assertCampaignAccess(
    session: AuthSession,
    campaignId: string,
    mode: 'manage' | 'read' | 'revoke',
  ) {
    const [campaign] = await this.database.orm
      .select({ creatorId: giftCampaigns.creatorId, organizationId: giftCampaigns.organizationId })
      .from(giftCampaigns)
      .where(eq(giftCampaigns.id, campaignId))
      .limit(1);
    if (!campaign) throw new AppError('CAMPAIGN_NOT_FOUND', 'Campaign not found.', 404);
    if (session.user.platformRole === 'PLATFORM_ADMIN') return campaign;
    const [membership] = await this.database.orm
      .select({ id: organizationMembers.id, role: organizationMembers.role })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, campaign.organizationId),
          eq(organizationMembers.userId, session.user.id),
        ),
      )
      .limit(1);
    const allowed =
      membership &&
      (mode === 'read' ||
        (mode === 'manage' && ['OWNER', 'ADMIN', 'OPERATOR'].includes(membership.role)) ||
        (mode === 'revoke' && ['OWNER', 'ADMIN'].includes(membership.role)));
    if (!allowed) throw new AppError('CAMPAIGN_ACCESS_DENIED', 'Campaign access denied.', 403);
    const scopes = await this.database.orm
      .select({ creatorId: memberCreatorScopes.creatorId })
      .from(memberCreatorScopes)
      .where(eq(memberCreatorScopes.memberId, membership.id));
    if (scopes.length > 0 && !scopes.some((scope) => scope.creatorId === campaign.creatorId)) {
      throw new AppError('CAMPAIGN_ACCESS_DENIED', 'Campaign access denied.', 403);
    }
    return campaign;
  }

  public async assertEntitlementRevocationAccess(session: AuthSession, entitlementId: string) {
    const [entitlement] = await this.database.orm
      .select({ campaignId: entitlements.campaignId })
      .from(entitlements)
      .where(eq(entitlements.id, entitlementId))
      .limit(1);
    if (!entitlement) throw new AppError('ENTITLEMENT_NOT_FOUND', 'Entitlement not found.', 404);
    return this.assertCampaignAccess(session, entitlement.campaignId, 'revoke');
  }
}
