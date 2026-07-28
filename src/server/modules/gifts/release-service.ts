import { randomUUID } from 'node:crypto';

import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import { AppError } from '../../../shared/errors/app-error.js';
import type { AppDatabase, DatabaseService } from '../../infrastructure/db/database.js';
import {
  giftOrderItems,
  giftOrders,
  giftPackageItems,
  giftPackages,
  giftReleases,
  giftTierRules,
  snapshotMembers,
  snapshotRuns,
  type GiftOrderPackageSnapshot,
  type GiftReleaseField,
  type GuardTier,
} from '../../infrastructure/db/schema.js';
import { AuditService, type RequestAuditContext } from '../audit/audit-service.js';

const TIERS = ['CAPTAIN', 'ADMIRAL', 'GOVERNOR'] as const;
const TIER_INDEX: Readonly<Record<GuardTier, number>> = {
  CAPTAIN: 0,
  ADMIRAL: 1,
  GOVERNOR: 2,
};

export interface ReleasePackageInput {
  readonly description: string;
  readonly items: readonly {
    readonly description: string;
    readonly name: string;
    readonly quantity: number;
  }[];
  readonly name: string;
}

export interface ReleaseDraftInput {
  readonly claimDeadlineAt: string;
  readonly claimStartAt: string;
  readonly description: string;
  readonly eligibilityMonth: string;
  readonly formFields: readonly GiftReleaseField[];
  readonly fulfillmentMode: 'HIGHEST_ONLY' | 'CUMULATIVE';
  readonly packages: readonly ReleasePackageInput[];
  readonly tierPackageIndexes: Readonly<Record<GuardTier, number>>;
  readonly title: string;
}

function validateDraft(input: ReleaseDraftInput) {
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(input.eligibilityMonth)) {
    throw new AppError(
      'GIFT_RELEASE_MONTH_INVALID',
      'Eligibility month must be the first day of a calendar month.',
      400,
    );
  }
  const title = input.title.trim();
  const description = input.description.trim();
  if (!title || title.length > 160 || description.length > 5_000) {
    throw new AppError('GIFT_RELEASE_CONTENT_INVALID', 'Gift release content is invalid.', 400);
  }
  const claimStartAt = new Date(input.claimStartAt);
  const claimDeadlineAt = new Date(input.claimDeadlineAt);
  if (
    Number.isNaN(claimStartAt.getTime()) ||
    Number.isNaN(claimDeadlineAt.getTime()) ||
    claimDeadlineAt <= claimStartAt
  ) {
    throw new AppError('GIFT_RELEASE_WINDOW_INVALID', 'The claim window is invalid.', 400);
  }
  if (input.packages.length < 1 || input.packages.length > 12) {
    throw new AppError(
      'GIFT_RELEASE_PACKAGES_INVALID',
      'A release requires between one and twelve gift packages.',
      400,
    );
  }
  const packageNames = new Set<string>();
  for (const package_ of input.packages) {
    const name = package_.name.trim();
    if (!name || name.length > 120 || packageNames.has(name)) {
      throw new AppError(
        'GIFT_RELEASE_PACKAGES_INVALID',
        'Gift package names must be present and unique.',
        400,
      );
    }
    packageNames.add(name);
    if (package_.description.trim().length > 2_000 || package_.items.length > 30) {
      throw new AppError(
        'GIFT_RELEASE_PACKAGES_INVALID',
        'A gift package contains invalid content.',
        400,
      );
    }
    for (const item of package_.items) {
      if (
        !item.name.trim() ||
        item.name.trim().length > 120 ||
        item.description.trim().length > 1_000 ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 999
      ) {
        throw new AppError('GIFT_RELEASE_ITEM_INVALID', 'A gift item is invalid.', 400);
      }
    }
  }
  for (const tier of TIERS) {
    const index = input.tierPackageIndexes[tier];
    if (!Number.isInteger(index) || index < 0 || index >= input.packages.length) {
      throw new AppError(
        'GIFT_RELEASE_TIER_RULE_INVALID',
        `A package must be selected for ${tier}.`,
        400,
      );
    }
  }
  if (input.formFields.length > 20) {
    throw new AppError('GIFT_RELEASE_FORM_INVALID', 'Too many claim fields.', 400);
  }
  const fieldKeys = new Set<string>();
  for (const field of input.formFields) {
    if (
      !/^[a-z][a-z0-9_]{0,39}$/.test(field.key) ||
      fieldKeys.has(field.key) ||
      !field.label.trim() ||
      field.label.trim().length > 120
    ) {
      throw new AppError(
        'GIFT_RELEASE_FORM_INVALID',
        'Claim fields require unique valid keys and labels.',
        400,
      );
    }
    fieldKeys.add(field.key);
    const options = field.options ?? [];
    const optionField = field.type === 'SELECT' || field.type === 'RADIO';
    if (
      (optionField && (options.length < 1 || options.length > 30)) ||
      (!optionField && options.length > 0) ||
      options.some((option) => !option.trim() || option.length > 120) ||
      new Set(options).size !== options.length
    ) {
      throw new AppError('GIFT_RELEASE_FORM_INVALID', 'Claim field options are invalid.', 400);
    }
  }
  return {
    claimDeadlineAt,
    claimStartAt,
    description,
    title,
  };
}

function uniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if ('code' in error && error.code === '23505') return true;
  return 'cause' in error && uniqueViolation(error.cause);
}

export class GiftReleaseService {
  private readonly audit: AuditService;

  public constructor(private readonly database: DatabaseService) {
    this.audit = new AuditService(database);
  }

  public list(creatorId: string) {
    return this.database.orm
      .select()
      .from(giftReleases)
      .where(eq(giftReleases.creatorId, creatorId))
      .orderBy(desc(giftReleases.eligibilityMonth));
  }

  public async get(creatorId: string, releaseId: string) {
    const [release] = await this.database.orm
      .select()
      .from(giftReleases)
      .where(and(eq(giftReleases.id, releaseId), eq(giftReleases.creatorId, creatorId)))
      .limit(1);
    if (!release) throw new AppError('GIFT_RELEASE_NOT_FOUND', 'Gift release not found.', 404);
    const packages = await this.database.orm
      .select()
      .from(giftPackages)
      .where(eq(giftPackages.giftReleaseId, release.id))
      .orderBy(asc(giftPackages.sortOrder));
    const packageIds = packages.map((package_) => package_.id);
    const [items, rules] = await Promise.all([
      packageIds.length === 0
        ? []
        : this.database.orm
            .select()
            .from(giftPackageItems)
            .where(inArray(giftPackageItems.giftPackageId, packageIds))
            .orderBy(asc(giftPackageItems.sortOrder)),
      this.database.orm
        .select()
        .from(giftTierRules)
        .where(eq(giftTierRules.giftReleaseId, release.id)),
    ]);
    return {
      ...release,
      formFields: release.formSchema,
      packages: packages.map((package_) => ({
        ...package_,
        items: items.filter((item) => item.giftPackageId === package_.id),
      })),
      tierPackageIndexes: Object.fromEntries(
        rules.map((rule) => [
          rule.tier,
          packages.findIndex((package_) => package_.id === rule.giftPackageId),
        ]),
      ),
    };
  }

  private async replaceConfiguration(
    executor: AppDatabase,
    releaseId: string,
    input: ReleaseDraftInput,
  ) {
    await executor.delete(giftTierRules).where(eq(giftTierRules.giftReleaseId, releaseId));
    await executor.delete(giftPackages).where(eq(giftPackages.giftReleaseId, releaseId));
    const packageRows = input.packages.map((package_, index) => ({
      description: package_.description.trim(),
      giftReleaseId: releaseId,
      id: randomUUID(),
      name: package_.name.trim(),
      sortOrder: index,
    }));
    await executor.insert(giftPackages).values(packageRows);
    const itemRows = input.packages.flatMap((package_, packageIndex) =>
      package_.items.map((item, itemIndex) => ({
        description: item.description.trim(),
        giftPackageId: packageRows[packageIndex]!.id,
        name: item.name.trim(),
        quantity: item.quantity,
        sortOrder: itemIndex,
      })),
    );
    if (itemRows.length > 0) await executor.insert(giftPackageItems).values(itemRows);
    await executor.insert(giftTierRules).values(
      TIERS.map((tier) => ({
        giftPackageId: packageRows[input.tierPackageIndexes[tier]]!.id,
        giftReleaseId: releaseId,
        tier,
      })),
    );
  }

  public async create(creatorId: string, input: ReleaseDraftInput, context: RequestAuditContext) {
    const validated = validateDraft(input);
    try {
      const release = await this.database.orm.transaction(async (transaction) => {
        const [created] = await transaction
          .insert(giftReleases)
          .values({
            claimDeadlineAt: validated.claimDeadlineAt,
            claimStartAt: validated.claimStartAt,
            createdByUserId: context.actorUserId,
            creatorId,
            description: validated.description,
            eligibilityMonth: input.eligibilityMonth,
            formSchema: input.formFields,
            fulfillmentMode: input.fulfillmentMode,
            title: validated.title,
          })
          .returning();
        if (!created) throw new Error('Gift release insert returned no row.');
        await this.replaceConfiguration(transaction, created.id, input);
        await this.audit.record(
          {
            action: 'gift-release.created',
            actorUserId: context.actorUserId,
            afterSummary: {
              eligibilityMonth: created.eligibilityMonth,
              packageCount: input.packages.length,
              title: created.title,
            },
            creatorId,
            ipAddress: context.ipAddress,
            requestId: context.requestId,
            targetId: created.id,
            targetType: 'gift-release',
          },
          transaction,
        );
        return created;
      });
      return this.get(creatorId, release.id);
    } catch (error) {
      if (uniqueViolation(error)) {
        throw new AppError(
          'GIFT_RELEASE_MONTH_CONFLICT',
          'This creator already has a gift release for that month.',
          409,
        );
      }
      throw error;
    }
  }

  public async update(
    creatorId: string,
    releaseId: string,
    input: ReleaseDraftInput,
    context: RequestAuditContext,
  ) {
    const validated = validateDraft(input);
    try {
      await this.database.orm.transaction(async (transaction) => {
        const [before] = await transaction
          .select()
          .from(giftReleases)
          .where(and(eq(giftReleases.id, releaseId), eq(giftReleases.creatorId, creatorId)))
          .limit(1)
          .for('update');
        if (!before) throw new AppError('GIFT_RELEASE_NOT_FOUND', 'Gift release not found.', 404);
        if (before.status !== 'DRAFT') {
          throw new AppError(
            'GIFT_RELEASE_IMMUTABLE',
            'A published gift release can no longer be edited.',
            409,
          );
        }
        await transaction
          .update(giftReleases)
          .set({
            claimDeadlineAt: validated.claimDeadlineAt,
            claimStartAt: validated.claimStartAt,
            description: validated.description,
            eligibilityMonth: input.eligibilityMonth,
            formSchema: input.formFields,
            fulfillmentMode: input.fulfillmentMode,
            title: validated.title,
            updatedAt: new Date(),
          })
          .where(eq(giftReleases.id, before.id));
        await this.replaceConfiguration(transaction, before.id, input);
        await this.audit.record(
          {
            action: 'gift-release.updated',
            actorUserId: context.actorUserId,
            afterSummary: {
              eligibilityMonth: input.eligibilityMonth,
              packageCount: input.packages.length,
              title: validated.title,
            },
            beforeSummary: {
              eligibilityMonth: before.eligibilityMonth,
              title: before.title,
            },
            creatorId,
            ipAddress: context.ipAddress,
            requestId: context.requestId,
            targetId: before.id,
            targetType: 'gift-release',
          },
          transaction,
        );
      });
      return this.get(creatorId, releaseId);
    } catch (error) {
      if (uniqueViolation(error)) {
        throw new AppError(
          'GIFT_RELEASE_MONTH_CONFLICT',
          'This creator already has a gift release for that month.',
          409,
        );
      }
      throw error;
    }
  }

  public async publish(creatorId: string, releaseId: string, context: RequestAuditContext) {
    await this.database.orm.transaction(async (transaction) => {
      const [release] = await transaction
        .select()
        .from(giftReleases)
        .where(and(eq(giftReleases.id, releaseId), eq(giftReleases.creatorId, creatorId)))
        .limit(1)
        .for('update');
      if (!release) throw new AppError('GIFT_RELEASE_NOT_FOUND', 'Gift release not found.', 404);
      if (release.status === 'PUBLISHED') {
        await this.reconcileRelease(release.id, transaction);
        return;
      }
      if (release.status !== 'DRAFT') {
        throw new AppError(
          'GIFT_RELEASE_NOT_PUBLISHABLE',
          'This release cannot be published.',
          409,
        );
      }
      const rules = await transaction
        .select()
        .from(giftTierRules)
        .where(eq(giftTierRules.giftReleaseId, release.id));
      if (new Set(rules.map((rule) => rule.tier)).size !== 3) {
        throw new AppError(
          'GIFT_RELEASE_INCOMPLETE',
          'Every guard tier must have a gift package.',
          409,
        );
      }
      const now = new Date();
      await transaction
        .update(giftReleases)
        .set({ publishedAt: now, status: 'PUBLISHED', updatedAt: now })
        .where(eq(giftReleases.id, release.id));
      const createdOrders = await this.reconcileRelease(release.id, transaction);
      await this.audit.record(
        {
          action: 'gift-release.published',
          actorUserId: context.actorUserId,
          afterSummary: {
            eligibilityMonth: release.eligibilityMonth,
            generatedOrders: createdOrders,
          },
          creatorId,
          ipAddress: context.ipAddress,
          requestId: context.requestId,
          targetId: release.id,
          targetType: 'gift-release',
        },
        transaction,
      );
    });
    return this.get(creatorId, releaseId);
  }

  public async close(creatorId: string, releaseId: string, context: RequestAuditContext) {
    const [release] = await this.database.orm
      .update(giftReleases)
      .set({ closedAt: new Date(), status: 'CLOSED', updatedAt: new Date() })
      .where(
        and(
          eq(giftReleases.id, releaseId),
          eq(giftReleases.creatorId, creatorId),
          eq(giftReleases.status, 'PUBLISHED'),
        ),
      )
      .returning();
    if (!release) {
      throw new AppError('GIFT_RELEASE_NOT_CLOSABLE', 'Published gift release not found.', 409);
    }
    await this.audit.record({
      action: 'gift-release.closed',
      actorUserId: context.actorUserId,
      creatorId,
      ipAddress: context.ipAddress,
      requestId: context.requestId,
      targetId: release.id,
      targetType: 'gift-release',
    });
    return release;
  }

  public async removeDraft(
    creatorId: string,
    releaseId: string,
    context: RequestAuditContext,
  ): Promise<void> {
    const [deleted] = await this.database.orm
      .delete(giftReleases)
      .where(
        and(
          eq(giftReleases.id, releaseId),
          eq(giftReleases.creatorId, creatorId),
          eq(giftReleases.status, 'DRAFT'),
        ),
      )
      .returning({ id: giftReleases.id });
    if (!deleted) throw new AppError('GIFT_RELEASE_NOT_DELETABLE', 'Draft not found.', 404);
    await this.audit.record({
      action: 'gift-release.deleted',
      actorUserId: context.actorUserId,
      creatorId,
      ipAddress: context.ipAddress,
      requestId: context.requestId,
      targetId: releaseId,
      targetType: 'gift-release',
    });
  }

  public async reconcileSnapshot(runId: string, executor: AppDatabase): Promise<number> {
    const [run] = await executor
      .select({
        creatorId: snapshotRuns.creatorId,
        periodStart: snapshotRuns.periodStart,
        status: snapshotRuns.status,
      })
      .from(snapshotRuns)
      .where(eq(snapshotRuns.id, runId))
      .limit(1);
    if (!run || run.status !== 'FINALIZED') return 0;
    const [release] = await executor
      .select({ id: giftReleases.id })
      .from(giftReleases)
      .where(
        and(
          eq(giftReleases.creatorId, run.creatorId),
          eq(giftReleases.eligibilityMonth, run.periodStart),
          eq(giftReleases.status, 'PUBLISHED'),
        ),
      )
      .limit(1);
    return release ? this.reconcileRelease(release.id, executor) : 0;
  }

  public async reconcileRelease(
    releaseId: string,
    executor: AppDatabase = this.database.orm,
  ): Promise<number> {
    const [release] = await executor
      .select()
      .from(giftReleases)
      .where(eq(giftReleases.id, releaseId))
      .limit(1);
    if (!release || release.status !== 'PUBLISHED') return 0;
    const [run] = await executor
      .select({ id: snapshotRuns.id })
      .from(snapshotRuns)
      .where(
        and(
          eq(snapshotRuns.creatorId, release.creatorId),
          eq(snapshotRuns.periodStart, release.eligibilityMonth),
          eq(snapshotRuns.status, 'FINALIZED'),
        ),
      )
      .limit(1);
    if (!run) return 0;
    const members = await executor
      .select()
      .from(snapshotMembers)
      .where(eq(snapshotMembers.snapshotRunId, run.id));
    if (members.length === 0) return 0;

    const packages = await executor
      .select()
      .from(giftPackages)
      .where(eq(giftPackages.giftReleaseId, release.id))
      .orderBy(asc(giftPackages.sortOrder));
    const packageIds = packages.map((package_) => package_.id);
    const [items, rules] = await Promise.all([
      executor
        .select()
        .from(giftPackageItems)
        .where(inArray(giftPackageItems.giftPackageId, packageIds))
        .orderBy(asc(giftPackageItems.sortOrder)),
      executor.select().from(giftTierRules).where(eq(giftTierRules.giftReleaseId, release.id)),
    ]);
    const packageById = new Map(packages.map((package_) => [package_.id, package_]));
    const ruleByTier = new Map(
      rules.map((rule) => [rule.tier as GuardTier, rule.giftPackageId] as const),
    );
    const packageSnapshot = new Map<string, GiftOrderPackageSnapshot>(
      packages.map((package_) => [
        package_.id,
        {
          description: package_.description,
          items: items
            .filter((item) => item.giftPackageId === package_.id)
            .map((item) => ({
              description: item.description,
              name: item.name,
              quantity: item.quantity,
            })),
          name: package_.name,
        },
      ]),
    );
    const candidates = members.map((member) => ({
      biliDisplayName: member.displayNameAtSnapshot,
      biliUid: member.biliUid,
      creatorId: release.creatorId,
      expiresAt: release.claimDeadlineAt,
      giftReleaseId: release.id,
      id: randomUUID(),
      orderNumber: `G${release.eligibilityMonth.slice(0, 7).replace('-', '')}-${randomUUID()
        .slice(0, 8)
        .toUpperCase()}`,
      snapshotMemberId: member.id,
      tier: member.tier,
      userId: null,
    }));
    const inserted = await executor
      .insert(giftOrders)
      .values(candidates)
      .onConflictDoNothing()
      .returning({
        id: giftOrders.id,
        snapshotMemberId: giftOrders.snapshotMemberId,
        tier: giftOrders.tier,
      });
    if (inserted.length === 0) return 0;
    const candidateByMember = new Map(members.map((member) => [member.id, member] as const));
    const orderItems = inserted.flatMap((order) => {
      const member = candidateByMember.get(order.snapshotMemberId);
      if (!member) throw new Error('Inserted gift order lost its snapshot member.');
      const tier = member.tier as GuardTier;
      const eligibleTiers =
        release.fulfillmentMode === 'CUMULATIVE' ? TIERS.slice(0, TIER_INDEX[tier] + 1) : [tier];
      const eligiblePackageIds = [
        ...new Set(eligibleTiers.map((eligibleTier) => ruleByTier.get(eligibleTier))),
      ].filter((id): id is string => Boolean(id));
      return eligiblePackageIds.map((giftPackageId, index) => {
        if (!packageById.has(giftPackageId) || !packageSnapshot.has(giftPackageId)) {
          throw new Error('Published release contains an invalid tier package.');
        }
        return {
          giftOrderId: order.id,
          giftPackageId,
          packageSnapshot: packageSnapshot.get(giftPackageId)!,
          sortOrder: index,
        };
      });
    });
    if (orderItems.length > 0) await executor.insert(giftOrderItems).values(orderItems);
    return inserted.length;
  }
}
