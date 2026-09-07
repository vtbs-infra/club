import { and, asc, count, desc, eq, ilike, isNull, lt, or, sql, type SQL } from 'drizzle-orm';

import type { GiftOrderListFilter } from '../../../shared/contracts/gifts.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import { loadOrderPackages } from './order-packages.js';
import { effectiveOrderStatus, orderStatusSelection } from './order-status.js';
import { AppError } from '../../../shared/errors/app-error.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import {
  bilibiliBindings,
  creators,
  giftCoverObjects,
  giftOrderAddresses,
  giftOrderOptionValues,
  giftOrders,
  giftReleases,
  type GiftOrderStatus,
  type StoredGiftOrderStatus,
} from '../../infrastructure/db/schema/index.js';
import {
  EncryptionError,
  type EncryptionKeyRing,
} from '../../infrastructure/encryption/key-ring.js';
import type { AddressPayload } from '../addresses/address-domain.js';
import { AuditService, type RequestAuditContext } from '../audit/audit-service.js';

function shippingRecord(order: {
  status: GiftOrderStatus | StoredGiftOrderStatus;
  carrierName: string | null;
  trackingNumber: string | null;
}) {
  if (order.status !== 'SHIPPED') return null;
  if (!order.carrierName || !order.trackingNumber)
    throw new Error('A shipped order is missing its shipping record.');
  return { carrierName: order.carrierName, trackingNumber: order.trackingNumber };
}

type ClaimValue = boolean | string;
type GiftOrderCursor = { readonly orderNumber: string };
type FulfillmentReleaseCursor = { readonly eligibilityMonth: string; readonly id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GIFT_ORDER_NUMBER = /^G\d{4}(0[1-9]|1[0-2])-[0-9A-F]{32}$/;
const ELIGIBILITY_MONTH = /^\d{4}-(0[1-9]|1[0-2])-01$/;

function decodeGiftOrderCursor(value: string, code: string): GiftOrderCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid cursor payload.');
    const record = parsed as Record<string, unknown>;
    if (typeof record.orderNumber !== 'string' || !GIFT_ORDER_NUMBER.test(record.orderNumber)) {
      throw new Error('Invalid cursor fields.');
    }
    return { orderNumber: record.orderNumber };
  } catch {
    throw new AppError(code, 'The page cursor is invalid.', 400);
  }
}

function encodeGiftOrderCursor(row: { readonly orderNumber: string }): string {
  return Buffer.from(JSON.stringify({ orderNumber: row.orderNumber }), 'utf8').toString(
    'base64url',
  );
}

function decodeFulfillmentReleaseCursor(value: string): FulfillmentReleaseCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid cursor payload.');
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.eligibilityMonth !== 'string' ||
      typeof record.id !== 'string' ||
      !ELIGIBILITY_MONTH.test(record.eligibilityMonth) ||
      !UUID.test(record.id)
    ) {
      throw new Error('Invalid cursor fields.');
    }
    return { eligibilityMonth: record.eligibilityMonth, id: record.id };
  } catch {
    throw new AppError(
      'FULFILLMENT_RELEASE_CURSOR_INVALID',
      'The fulfillment-release cursor is invalid.',
      400,
    );
  }
}

function encodeFulfillmentReleaseCursor(row: FulfillmentReleaseCursor): string {
  return Buffer.from(
    JSON.stringify({ eligibilityMonth: row.eligibilityMonth, id: row.id }),
    'utf8',
  ).toString('base64url');
}

function filterCondition(filter: GiftOrderListFilter, now: Date): SQL | undefined {
  if (filter === 'ALL') return undefined;
  if (filter === 'ENDED') {
    return or(eq(effectiveOrderStatus(now), 'EXPIRED'), eq(giftOrders.status, 'CANCELLED'));
  }
  return eq(effectiveOrderStatus(now), filter);
}

function escapedPrefix(value: string): string {
  return `${value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
}

function emptyCounts() {
  return {
    upcoming: 0,
    cancelled: 0,
    claimable: 0,

    expired: 0,
    shipped: 0,
    submitted: 0,
  };
}

function statusCounts(row: Record<string, unknown> | undefined) {
  const counts = emptyCounts();
  if (!row) return counts;
  for (const key of Object.keys(counts) as Array<keyof typeof counts>) {
    counts[key] = Number(row[key] ?? 0);
  }
  return counts;
}

export class GiftOrderQueryService {
  private readonly audit: AuditService;

  public constructor(
    private readonly database: DatabaseService,
    private readonly encryption: EncryptionKeyRing,
    private readonly clock: Clock,
  ) {
    this.audit = new AuditService(database);
  }

  private async activeBinding(userId: string) {
    const [binding] = await this.database.orm
      .select({ biliUid: bilibiliBindings.biliUid })
      .from(bilibiliBindings)
      .where(and(eq(bilibiliBindings.userId, userId), isNull(bilibiliBindings.unboundAt)))
      .limit(1);
    return binding ?? null;
  }

  private async listSummaries(input: {
    readonly condition: SQL | undefined;
    readonly cursor?: string | undefined;
    readonly cursorCode: string;
    readonly limit: number;
  }) {
    const cursor = input.cursor ? decodeGiftOrderCursor(input.cursor, input.cursorCode) : null;
    const rows = await this.database.orm
      .select({
        creator: { displayName: creators.displayName, id: creators.id },
        order: {
          carrierName: giftOrders.carrierName,
          trackingNumber: giftOrders.trackingNumber,
          biliDisplayName: giftOrders.biliDisplayName,
          biliUid: giftOrders.biliUid,
          ...orderStatusSelection(this.clock.now()),
          id: giftOrders.id,
          orderNumber: giftOrders.orderNumber,
          tier: giftOrders.tier,
          updatedAt: giftOrders.updatedAt,
        },
        release: {
          claimDeadlineAt: giftReleases.claimDeadlineAt,
          claimStartAt: giftReleases.claimStartAt,
          coverObjectKey: giftCoverObjects.objectKey,
          eligibilityMonth: giftReleases.eligibilityMonth,
          id: giftReleases.id,
          title: giftReleases.title,
        },
      })
      .from(giftOrders)
      .innerJoin(giftReleases, eq(giftReleases.id, giftOrders.giftReleaseId))
      .innerJoin(creators, eq(creators.id, giftOrders.creatorId))
      .leftJoin(
        giftCoverObjects,
        and(
          eq(giftCoverObjects.giftReleaseId, giftReleases.id),
          eq(giftCoverObjects.state, 'ACTIVE'),
        ),
      )
      .where(
        and(input.condition, cursor ? lt(giftOrders.orderNumber, cursor.orderNumber) : undefined),
      )
      .orderBy(desc(giftOrders.orderNumber))
      .limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    const page = rows.slice(0, input.limit);
    return {
      items: page.map(({ creator, order, release }) => ({
        biliDisplayName: order.biliDisplayName,
        biliUid: order.biliUid,
        creator,
        expiresAt: order.expiresAt,
        expiredAt: order.expiredAt,
        expiryReason: order.expiryReason,
        id: order.id,
        orderNumber: order.orderNumber,
        release: {
          claimDeadlineAt: release.claimDeadlineAt,
          claimStartAt: release.claimStartAt,
          coverImageUrl: release.coverObjectKey
            ? `/api/v1/gift-releases/${release.id}/cover`
            : null,
          eligibilityMonth: release.eligibilityMonth,
          id: release.id,
          title: release.title,
        },
        shipping: shippingRecord(order),
        status: order.status,
        tier: order.tier,
        updatedAt: order.updatedAt,
      })),
      nextCursor: hasMore ? encodeGiftOrderCursor(page.at(-1)!.order) : null,
    };
  }

  public async listForUser(
    userId: string,
    input: {
      readonly cursor?: string | undefined;
      readonly filter: GiftOrderListFilter;
      readonly limit: number;
    },
  ) {
    const binding = await this.activeBinding(userId);
    const access = binding
      ? or(eq(giftOrders.userId, userId), eq(giftOrders.biliUid, binding.biliUid))
      : eq(giftOrders.userId, userId);
    return this.listSummaries({
      condition: and(access, filterCondition(input.filter, this.clock.now())),
      cursor: input.cursor,
      cursorCode: 'GIFT_ORDER_CURSOR_INVALID',
      limit: input.limit,
    });
  }

  public async listForCreator(
    creatorId: string,
    input: {
      readonly cursor?: string | undefined;
      readonly limit: number;
      readonly search?: string | undefined;
      readonly status?: GiftOrderStatus | undefined;
    },
  ) {
    const search = input.search?.trim();
    const prefix = search ? escapedPrefix(search) : null;
    return this.listSummaries({
      condition: and(
        eq(giftOrders.creatorId, creatorId),
        input.status ? eq(effectiveOrderStatus(this.clock.now()), input.status) : undefined,
        prefix
          ? or(
              ilike(giftOrders.orderNumber, prefix),
              ilike(giftOrders.biliDisplayName, prefix),
              ilike(giftOrders.biliUid, prefix),
              ilike(giftReleases.title, prefix),
            )
          : undefined,
      ),
      cursor: input.cursor,
      cursorCode: 'CREATOR_GIFT_ORDER_CURSOR_INVALID',
      limit: input.limit,
    });
  }

  private countSelection(condition: SQL) {
    return this.database.orm
      .select({
        cancelled: sql<number>`count(*) filter (where ${giftOrders.status} = 'CANCELLED')::int`,
        claimable: sql<number>`count(*) filter (where ${effectiveOrderStatus(this.clock.now())} = 'CLAIMABLE')::int`,
        upcoming: sql<number>`count(*) filter (where ${effectiveOrderStatus(this.clock.now())} = 'UPCOMING')::int`,
        expired: sql<number>`count(*) filter (where ${effectiveOrderStatus(this.clock.now())} = 'EXPIRED')::int`,
        shipped: sql<number>`count(*) filter (where ${giftOrders.status} = 'SHIPPED')::int`,
        submitted: sql<number>`count(*) filter (where ${giftOrders.status} = 'SUBMITTED')::int`,
      })
      .from(giftOrders)
      .innerJoin(giftReleases, eq(giftReleases.id, giftOrders.giftReleaseId))
      .where(condition);
  }

  public async overviewForUser(userId: string) {
    const binding = await this.activeBinding(userId);
    const access = binding
      ? or(eq(giftOrders.userId, userId), eq(giftOrders.biliUid, binding.biliUid))!
      : eq(giftOrders.userId, userId);
    const now = this.clock.now();
    const [[counts], [urgent]] = await Promise.all([
      this.countSelection(access),
      this.database.orm
        .select({
          id: giftOrders.id,
          title: giftReleases.title,
          claimDeadlineAt: giftReleases.claimDeadlineAt,
        })
        .from(giftOrders)
        .innerJoin(giftReleases, eq(giftReleases.id, giftOrders.giftReleaseId))
        .where(
          and(
            access,
            eq(effectiveOrderStatus(now), 'CLAIMABLE'),
            sql`${giftReleases.claimDeadlineAt} < ${new Date(now.getTime() + 3 * 86_400_000).toISOString()}::timestamptz`,
          ),
        )
        .orderBy(asc(giftReleases.claimDeadlineAt), asc(giftOrders.id))
        .limit(1),
    ]);
    return { counts: statusCounts(counts), urgent: urgent ?? null };
  }

  public async overviewForCreator(creatorId: string) {
    const [[globalCounts], [releaseCount], [activeRelease]] = await Promise.all([
      this.countSelection(eq(giftOrders.creatorId, creatorId)),
      this.database.orm
        .select({ value: count() })
        .from(giftReleases)
        .where(eq(giftReleases.creatorId, creatorId)),
      this.database.orm
        .select({
          eligibilityMonth: giftReleases.eligibilityMonth,
          id: giftReleases.id,
          title: giftReleases.title,
        })
        .from(giftReleases)
        .where(and(eq(giftReleases.creatorId, creatorId), eq(giftReleases.status, 'PUBLISHED')))
        .orderBy(desc(giftReleases.createdAt), desc(giftReleases.id))
        .limit(1),
    ]);
    const [activeCounts] = activeRelease
      ? await this.countSelection(eq(giftOrders.giftReleaseId, activeRelease.id))
      : [];
    return {
      activeRelease: activeRelease
        ? { ...activeRelease, counts: statusCounts(activeCounts) }
        : null,
      counts: statusCounts(globalCounts),
      releaseCount: Number(releaseCount?.value ?? 0),
    };
  }

  public async listFulfillmentReleases(
    creatorId: string,
    input: { readonly cursor?: string | undefined; readonly limit: number },
  ) {
    const cursor = input.cursor ? decodeFulfillmentReleaseCursor(input.cursor) : null;
    const rows = await this.database.orm
      .select({
        claimDeadlineAt: giftReleases.claimDeadlineAt,
        eligibilityMonth: giftReleases.eligibilityMonth,
        id: giftReleases.id,
        submittedCount: count(giftOrders.id),
        title: giftReleases.title,
      })
      .from(giftReleases)
      .innerJoin(
        giftOrders,
        and(eq(giftOrders.giftReleaseId, giftReleases.id), eq(giftOrders.status, 'SUBMITTED')),
      )
      .where(
        and(
          eq(giftReleases.creatorId, creatorId),
          cursor
            ? or(
                lt(giftReleases.eligibilityMonth, cursor.eligibilityMonth),
                and(
                  eq(giftReleases.eligibilityMonth, cursor.eligibilityMonth),
                  lt(giftReleases.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .groupBy(
        giftReleases.claimDeadlineAt,
        giftReleases.eligibilityMonth,
        giftReleases.id,
        giftReleases.title,
      )
      .orderBy(desc(giftReleases.eligibilityMonth), desc(giftReleases.id))
      .limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    const page = rows.slice(0, input.limit);
    return {
      items: page.map((row) => ({
        claimDeadlineAt: row.claimDeadlineAt,
        eligibilityMonth: row.eligibilityMonth,
        id: row.id,
        submittedCount: Number(row.submittedCount),
        title: row.title,
      })),
      nextCursor: hasMore ? encodeFulfillmentReleaseCursor(page.at(-1)!) : null,
    };
  }

  private loadDetailRows(condition: SQL) {
    return this.database.orm
      .select({
        creator: { displayName: creators.displayName, id: creators.id },
        order: giftOrders,
        effectiveState: orderStatusSelection(this.clock.now()),
        release: {
          claimDeadlineAt: giftReleases.claimDeadlineAt,
          claimStartAt: giftReleases.claimStartAt,
          coverObjectKey: giftCoverObjects.objectKey,
          description: giftReleases.description,
          eligibilityMonth: giftReleases.eligibilityMonth,
          formFields: giftReleases.formSchema,
          id: giftReleases.id,
          title: giftReleases.title,
        },
      })
      .from(giftOrders)
      .innerJoin(giftReleases, eq(giftReleases.id, giftOrders.giftReleaseId))
      .innerJoin(creators, eq(creators.id, giftOrders.creatorId))
      .leftJoin(
        giftCoverObjects,
        and(
          eq(giftCoverObjects.giftReleaseId, giftReleases.id),
          eq(giftCoverObjects.state, 'ACTIVE'),
        ),
      )
      .where(condition)
      .limit(1);
  }

  private async serializeDetail(
    row: Awaited<ReturnType<GiftOrderQueryService['loadDetailRows']>>[number] | undefined,
  ) {
    if (!row) return null;
    const orderItems = await loadOrderPackages(this.database.orm, eq(giftOrders.id, row.order.id));
    return {
      ...row.order,
      ...row.effectiveState,
      creator: row.creator,
      items: orderItems.map(({ id, name, description, items }) => ({
        id,
        name,
        description,
        items,
      })),
      release: {
        ...row.release,
        coverImageUrl: row.release.coverObjectKey
          ? `/api/v1/gift-releases/${row.release.id}/cover`
          : null,
      },
      shipping: shippingRecord(row.order),
    };
  }

  public async getForUser(userId: string, orderId: string) {
    const binding = await this.activeBinding(userId);
    const access = binding
      ? or(eq(giftOrders.userId, userId), eq(giftOrders.biliUid, binding.biliUid))
      : eq(giftOrders.userId, userId);
    const [row] = await this.loadDetailRows(and(eq(giftOrders.id, orderId), access)!);
    const order = await this.serializeDetail(row);
    if (!order) throw new AppError('GIFT_ORDER_NOT_FOUND', 'Gift order not found.', 404);
    return order;
  }

  private decrypt<T>(
    row: {
      readonly authenticationTag: string;
      readonly ciphertext: string;
      readonly id: string;
      readonly initializationVector: string;
      readonly keyVersion: number;
    },
    purpose: string,
  ): T {
    try {
      return this.encryption.decrypt<T>(row, `${purpose}:${row.id}`);
    } catch (error) {
      if (error instanceof EncryptionError) {
        throw new AppError(
          'GIFT_ORDER_DECRYPTION_FAILED',
          'Encrypted fulfillment data could not be read.',
          500,
        );
      }
      throw error;
    }
  }

  public async getForCreator(creatorId: string, orderId: string, context: RequestAuditContext) {
    const [row] = await this.loadDetailRows(
      and(eq(giftOrders.id, orderId), eq(giftOrders.creatorId, creatorId))!,
    );
    const order = await this.serializeDetail(row);
    if (!order) throw new AppError('GIFT_ORDER_NOT_FOUND', 'Gift order not found.', 404);
    const [address] = await this.database.orm
      .select()
      .from(giftOrderAddresses)
      .where(eq(giftOrderAddresses.giftOrderId, order.id))
      .limit(1);
    const optionRows = await this.database.orm
      .select()
      .from(giftOrderOptionValues)
      .where(eq(giftOrderOptionValues.giftOrderId, order.id))
      .orderBy(asc(giftOrderOptionValues.createdAt));
    if (address || optionRows.length > 0) {
      await this.audit.record({
        action: 'gift-order.fulfillment-data-read',
        actorUserId: context.actorUserId,
        afterSummary: { address: Boolean(address), optionCount: optionRows.length },
        creatorId,
        ipAddress: context.ipAddress,
        requestId: context.requestId,
        targetId: order.id,
        targetType: 'gift-order',
      });
    }
    return {
      ...order,
      deliveryAddress: address ? this.decrypt<AddressPayload>(address, 'gift-order-address') : null,
      optionValues: optionRows.map((value) => ({
        key: value.fieldKey,
        label: value.fieldLabel,
        value: this.decrypt<ClaimValue>(value, 'gift-order-option'),
      })),
    };
  }
}
