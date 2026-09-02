import { randomUUID } from 'node:crypto';

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import type {
  ReleaseInput,
  ReleasePublishInput,
  ReleaseUpdateInput,
} from '../../../shared/contracts/gifts.js';
import { AppError } from '../../../shared/errors/app-error.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { AppDatabase, DatabaseService } from '../../infrastructure/db/database.js';
import {
  giftPackageItems,
  giftPackages,
  giftCoverObjects,
  giftOrders,
  giftOrderStatusHistory,
  giftReleases,
  giftTierRules,
} from '../../infrastructure/db/schema/index.js';
import { AuditService, type RequestAuditContext } from '../audit/audit-service.js';
import { GiftEligibilityService } from './eligibility-service.js';

const TIERS = ['CAPTAIN', 'ADMIRAL', 'GOVERNOR'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type ReleaseDraftInput = ReleaseInput;

type GiftReleaseCursor = { readonly createdAt: string; readonly id: string };

function decodeCursor(value: string): GiftReleaseCursor {
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
    throw new AppError('GIFT_RELEASE_CURSOR_INVALID', 'The gift-release cursor is invalid.', 400);
  }
}

function encodeCursor(row: GiftReleaseCursor): string {
  return Buffer.from(JSON.stringify({ createdAt: row.createdAt, id: row.id }), 'utf8').toString(
    'base64url',
  );
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
  public readonly eligibility: GiftEligibilityService;

  public constructor(
    private readonly database: DatabaseService,
    private readonly clock: Clock,
  ) {
    this.audit = new AuditService(database);
    this.eligibility = new GiftEligibilityService();
  }

  public async list(
    creatorId: string,
    input: { readonly cursor?: string | undefined; readonly limit: number },
  ) {
    const cursor = input.cursor ? decodeCursor(input.cursor) : null;
    const rows = await this.database.orm
      .select({
        coverObjectKey: giftCoverObjects.objectKey,
        cursorCreatedAt: sql<string>`${giftReleases.createdAt}::text`,
        release: {
          claimDeadlineAt: giftReleases.claimDeadlineAt,
          claimStartAt: giftReleases.claimStartAt,
          closedAt: giftReleases.closedAt,
          createdAt: giftReleases.createdAt,
          eligibilityMonth: giftReleases.eligibilityMonth,
          id: giftReleases.id,
          publicVisible: giftReleases.publicVisible,
          publishedAt: giftReleases.publishedAt,
          status: giftReleases.status,
          title: giftReleases.title,
          updatedAt: giftReleases.updatedAt,
          version: giftReleases.version,
        },
      })
      .from(giftReleases)
      .leftJoin(
        giftCoverObjects,
        and(
          eq(giftCoverObjects.giftReleaseId, giftReleases.id),
          eq(giftCoverObjects.state, 'ACTIVE'),
        ),
      )
      .where(
        and(
          eq(giftReleases.creatorId, creatorId),
          cursor
            ? sql`(${giftReleases.createdAt}, ${giftReleases.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(giftReleases.createdAt), desc(giftReleases.id))
      .limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit);
    return {
      items: items.map((row) => ({
        ...row.release,
        coverImageUrl: row.coverObjectKey ? `/api/v1/gift-releases/${row.release.id}/cover` : null,
      })),
      nextCursor: hasMore
        ? encodeCursor({
            createdAt: items.at(-1)!.cursorCreatedAt,
            id: items.at(-1)!.release.id,
          })
        : null,
    };
  }

  public async get(creatorId: string, releaseId: string) {
    const [selection] = await this.database.orm
      .select({ coverObjectKey: giftCoverObjects.objectKey, release: giftReleases })
      .from(giftReleases)
      .leftJoin(
        giftCoverObjects,
        and(
          eq(giftCoverObjects.giftReleaseId, giftReleases.id),
          eq(giftCoverObjects.state, 'ACTIVE'),
        ),
      )
      .where(and(eq(giftReleases.id, releaseId), eq(giftReleases.creatorId, creatorId)))
      .limit(1);
    const release = selection?.release;
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
      coverImageUrl: selection.coverObjectKey ? `/api/v1/gift-releases/${release.id}/cover` : null,
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
            publicVisible: input.publicVisible,
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
              publicVisible: created.publicVisible,
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
    input: ReleaseUpdateInput,
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
        if (before.version !== input.expectedVersion) {
          throw new AppError(
            'GIFT_RELEASE_VERSION_CONFLICT',
            'The gift release changed after it was opened. Reload it and try again.',
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
            publicVisible: input.publicVisible,
            title: validated.title,
            updatedAt: this.clock.now(),
            version: before.version + 1,
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
              publicVisible: input.publicVisible,
              title: validated.title,
            },
            beforeSummary: {
              eligibilityMonth: before.eligibilityMonth,
              publicVisible: before.publicVisible,
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

  public async publish(
    creatorId: string,
    releaseId: string,
    input: ReleasePublishInput,
    context: RequestAuditContext,
  ) {
    const validated = validateDraft(input);
    try {
      await this.database.orm.transaction(async (transaction) => {
        const [release] = await transaction
          .select()
          .from(giftReleases)
          .where(and(eq(giftReleases.id, releaseId), eq(giftReleases.creatorId, creatorId)))
          .limit(1)
          .for('update');
        if (!release) throw new AppError('GIFT_RELEASE_NOT_FOUND', 'Gift release not found.', 404);
        if (release.status === 'PUBLISHED') {
          await this.eligibility.reconcileRelease(release.id, transaction);
          return;
        }
        if (release.status !== 'DRAFT') {
          throw new AppError(
            'GIFT_RELEASE_NOT_PUBLISHABLE',
            'This release cannot be published.',
            409,
          );
        }
        if (release.version !== input.expectedVersion) {
          throw new AppError(
            'GIFT_RELEASE_VERSION_CONFLICT',
            'The gift release changed after it was opened. Reload it and try again.',
            409,
          );
        }
        if (validated.claimDeadlineAt <= this.clock.now()) {
          throw new AppError(
            'GIFT_RELEASE_NOT_PUBLISHABLE',
            'A gift release cannot be published after its claim deadline.',
            409,
          );
        }

        await this.replaceConfiguration(transaction, release.id, input);
        const now = this.clock.now();
        await transaction
          .update(giftReleases)
          .set({
            claimDeadlineAt: validated.claimDeadlineAt,
            claimStartAt: validated.claimStartAt,
            description: validated.description,
            eligibilityMonth: input.eligibilityMonth,
            formSchema: input.formFields,
            fulfillmentMode: input.fulfillmentMode,
            publicVisible: input.publicVisible,
            publishedAt: now,
            status: 'PUBLISHED',
            title: validated.title,
            updatedAt: now,
            version: release.version + 1,
          })
          .where(eq(giftReleases.id, release.id));
        const createdOrders = await this.eligibility.reconcileRelease(release.id, transaction);
        await this.audit.record(
          {
            action: 'gift-release.published',
            actorUserId: context.actorUserId,
            afterSummary: {
              eligibilityMonth: input.eligibilityMonth,
              generatedOrders: createdOrders,
              packageCount: input.packages.length,
              publicVisible: input.publicVisible,
              title: validated.title,
            },
            beforeSummary: {
              eligibilityMonth: release.eligibilityMonth,
              publicVisible: release.publicVisible,
              title: release.title,
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

  public async close(creatorId: string, releaseId: string, context: RequestAuditContext) {
    await this.database.orm.transaction(async (transaction) => {
      const [before] = await transaction
        .select()
        .from(giftReleases)
        .where(and(eq(giftReleases.id, releaseId), eq(giftReleases.creatorId, creatorId)))
        .limit(1)
        .for('update');
      if (!before || before.status !== 'PUBLISHED') {
        throw new AppError('GIFT_RELEASE_NOT_CLOSABLE', 'Published gift release not found.', 409);
      }
      const now = this.clock.now();
      await transaction
        .update(giftReleases)
        .set({
          closedAt: now,
          status: 'CLOSED',
          updatedAt: now,
          version: before.version + 1,
        })
        .where(eq(giftReleases.id, before.id));
      const expired = await transaction
        .update(giftOrders)
        .set({
          expiredAt: now,
          status: 'EXPIRED',
          updatedAt: now,
          version: sql`${giftOrders.version} + 1`,
        })
        .where(and(eq(giftOrders.giftReleaseId, before.id), eq(giftOrders.status, 'CLAIMABLE')))
        .returning({ id: giftOrders.id });
      if (expired.length > 0) {
        await transaction.insert(giftOrderStatusHistory).values(
          expired.map((order) => ({
            actorUserId: context.actorUserId,
            fromStatus: 'CLAIMABLE',
            giftOrderId: order.id,
            reason: 'Gift release closed by creator.',
            toStatus: 'EXPIRED',
          })),
        );
      }
      await this.audit.record(
        {
          action: 'gift-release.closed',
          actorUserId: context.actorUserId,
          afterSummary: { expiredOrders: expired.length },
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
  }

  public async removeDraft(
    creatorId: string,
    releaseId: string,
    context: RequestAuditContext,
  ): Promise<void> {
    await this.database.orm.transaction(async (transaction) => {
      const now = this.clock.now();
      const [release] = await transaction
        .select({ id: giftReleases.id })
        .from(giftReleases)
        .where(
          and(
            eq(giftReleases.id, releaseId),
            eq(giftReleases.creatorId, creatorId),
            eq(giftReleases.status, 'DRAFT'),
          ),
        )
        .limit(1)
        .for('update');
      if (!release) throw new AppError('GIFT_RELEASE_NOT_DELETABLE', 'Draft not found.', 404);
      await transaction
        .update(giftCoverObjects)
        .set({ giftReleaseId: null, state: 'DELETE_PENDING', updatedAt: now })
        .where(
          and(eq(giftCoverObjects.giftReleaseId, release.id), eq(giftCoverObjects.state, 'ACTIVE')),
        );
      const [deleted] = await transaction
        .delete(giftReleases)
        .where(eq(giftReleases.id, release.id))
        .returning({ id: giftReleases.id });
      if (!deleted) throw new Error('Locked gift release disappeared before deletion.');
      await this.audit.record(
        {
          action: 'gift-release.deleted',
          actorUserId: context.actorUserId,
          creatorId,
          ipAddress: context.ipAddress,
          requestId: context.requestId,
          targetId: releaseId,
          targetType: 'gift-release',
        },
        transaction,
      );
    });
  }
}
