import { and, asc, desc, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';

import { AppError } from '../../../shared/errors/app-error.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import {
  bilibiliBindings,
  creators,
  giftOrderAddresses,
  giftOrderItems,
  giftOrderOptionValues,
  giftOrders,
  giftReleases,
  shipments,
  trackingEvents,
  type GiftOrderStatus,
} from '../../infrastructure/db/schema/index.js';
import {
  EncryptionError,
  type EncryptionKeyRing,
} from '../../infrastructure/encryption/key-ring.js';
import type { AddressPayload } from '../addresses/address-domain.js';
import { AuditService, type RequestAuditContext } from '../audit/audit-service.js';

type ClaimValue = boolean | string;

export class GiftOrderQueryService {
  private readonly audit: AuditService;

  public constructor(
    private readonly database: DatabaseService,
    private readonly encryption: EncryptionKeyRing,
  ) {
    this.audit = new AuditService(database);
  }

  private async activeBinding(userId: string) {
    const [binding] = await this.database.orm
      .select({
        biliDisplayName: bilibiliBindings.biliDisplayName,
        biliUid: bilibiliBindings.biliUid,
      })
      .from(bilibiliBindings)
      .where(and(eq(bilibiliBindings.userId, userId), isNull(bilibiliBindings.unboundAt)))
      .limit(1);
    return binding ?? null;
  }

  private async loadRows(condition: SQL | undefined, limit?: number) {
    const query = this.database.orm
      .select({
        creator: {
          displayName: creators.displayName,
          id: creators.id,
        },
        order: giftOrders,
        release: {
          claimDeadlineAt: giftReleases.claimDeadlineAt,
          claimStartAt: giftReleases.claimStartAt,
          coverObjectKey: giftReleases.coverObjectKey,
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
      .where(condition)
      .orderBy(desc(giftOrders.updatedAt));
    return limit === undefined ? query : query.limit(limit);
  }

  private async serializeRows(rows: Awaited<ReturnType<GiftOrderQueryService['loadRows']>>) {
    const orderIds = rows.map((row) => row.order.id);
    if (orderIds.length === 0) return [];
    const orderItems = await this.database.orm
      .select()
      .from(giftOrderItems)
      .where(inArray(giftOrderItems.giftOrderId, orderIds))
      .orderBy(asc(giftOrderItems.sortOrder));
    const shipmentRows = await this.database.orm
      .select()
      .from(shipments)
      .where(inArray(shipments.giftOrderId, orderIds))
      .orderBy(desc(shipments.createdAt));
    const shipmentIds = shipmentRows.map((shipment) => shipment.id);
    const events =
      shipmentIds.length === 0
        ? []
        : await this.database.orm
            .select()
            .from(trackingEvents)
            .where(inArray(trackingEvents.shipmentId, shipmentIds))
            .orderBy(desc(trackingEvents.occurredAt));
    return rows.map(({ creator, order, release }) => ({
      ...order,
      creator,
      items: orderItems
        .filter((item) => item.giftOrderId === order.id)
        .map((item) => ({ id: item.id, ...item.packageSnapshot })),
      release: {
        ...release,
        coverImageUrl: release.coverObjectKey ? `/api/v1/gift-releases/${release.id}/cover` : null,
      },
      shipments: shipmentRows
        .filter((shipment) => shipment.giftOrderId === order.id)
        .map((shipment) => ({
          carrierName: shipment.carrierName,
          createdAt: shipment.createdAt,
          events: events
            .filter((event) => event.shipmentId === shipment.id)
            .map((event) => ({
              description: event.description,
              location: event.location,
              occurredAt: event.occurredAt,
              status: event.status,
            })),
          id: shipment.id,
          status: shipment.status,
          trackingNumber: shipment.trackingNumber,
          trackingUrl: shipment.trackingUrl,
        })),
    }));
  }

  public async listForUser(userId: string, limit?: number) {
    const binding = await this.activeBinding(userId);
    const condition = binding
      ? or(eq(giftOrders.userId, userId), eq(giftOrders.biliUid, binding.biliUid))
      : eq(giftOrders.userId, userId);
    return this.serializeRows(await this.loadRows(condition, limit));
  }

  public async getForUser(userId: string, orderId: string) {
    const binding = await this.activeBinding(userId);
    const access = binding
      ? or(eq(giftOrders.userId, userId), eq(giftOrders.biliUid, binding.biliUid))
      : eq(giftOrders.userId, userId);
    const rows = await this.loadRows(and(eq(giftOrders.id, orderId), access));
    const [order] = await this.serializeRows(rows);
    if (!order) throw new AppError('GIFT_ORDER_NOT_FOUND', 'Gift order not found.', 404);
    return order;
  }

  public async listForCreator(creatorId: string, status?: GiftOrderStatus) {
    return this.serializeRows(
      await this.loadRows(
        and(
          eq(giftOrders.creatorId, creatorId),
          status ? eq(giftOrders.status, status) : undefined,
        ),
      ),
    );
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
    const rows = await this.loadRows(
      and(eq(giftOrders.id, orderId), eq(giftOrders.creatorId, creatorId)),
    );
    const [order] = await this.serializeRows(rows);
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
