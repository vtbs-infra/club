import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { AppError } from '../../../shared/errors/app-error.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { AppDatabase, DatabaseService } from '../../infrastructure/db/database.js';
import {
  giftOrders,
  giftOrderStatusHistory,
  shipments,
} from '../../infrastructure/db/schema/index.js';
import { AuditService, type RequestAuditContext } from '../audit/audit-service.js';
import type { TrackingProvider } from '../fulfillment/tracking-provider.js';

function cleanText(value: string, maximum: number, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new AppError('SHIPMENT_INVALID', `${label} is invalid.`, 400);
  }
  return normalized;
}

export class GiftFulfillmentService {
  private readonly audit: AuditService;

  public constructor(
    private readonly database: DatabaseService,
    private readonly trackingProvider: TrackingProvider | null,
    private readonly clock: Clock,
  ) {
    this.audit = new AuditService(database);
  }

  private async lockOrder(transaction: AppDatabase, creatorId: string, orderId: string) {
    const [order] = await transaction
      .select()
      .from(giftOrders)
      .where(and(eq(giftOrders.id, orderId), eq(giftOrders.creatorId, creatorId)))
      .limit(1)
      .for('update');
    if (!order) throw new AppError('GIFT_ORDER_NOT_FOUND', 'Gift order not found.', 404);
    return order;
  }

  public async complete(creatorId: string, orderId: string, context: RequestAuditContext) {
    return this.database.orm.transaction(async (transaction) => {
      const order = await this.lockOrder(transaction, creatorId, orderId);
      if (order.status === 'COMPLETED') return order;
      if (order.status !== 'SHIPPED') {
        throw new AppError(
          'GIFT_ORDER_TRANSITION_INVALID',
          `A ${order.status} order cannot move to COMPLETED.`,
          409,
        );
      }
      const now = this.clock.now();
      const [updated] = await transaction
        .update(giftOrders)
        .set({
          completedAt: now,
          status: 'COMPLETED',
          updatedAt: now,
          version: order.version + 1,
        })
        .where(eq(giftOrders.id, order.id))
        .returning();
      await transaction.insert(giftOrderStatusHistory).values({
        actorUserId: context.actorUserId,
        fromStatus: 'SHIPPED',
        giftOrderId: order.id,
        toStatus: 'COMPLETED',
      });
      await this.audit.record(
        {
          action: 'gift-order.completed',
          actorUserId: context.actorUserId,
          afterSummary: { from: 'SHIPPED', to: 'COMPLETED' },
          creatorId,
          ipAddress: context.ipAddress,
          requestId: context.requestId,
          targetId: order.id,
          targetType: 'gift-order',
        },
        transaction,
      );
      return updated!;
    });
  }

  public async cancel(
    creatorId: string,
    orderId: string,
    reason: string,
    context: RequestAuditContext,
  ) {
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 3 || normalizedReason.length > 500) {
      throw new AppError('GIFT_ORDER_CANCEL_REASON_INVALID', 'A cancel reason is required.', 400);
    }
    return this.database.orm.transaction(async (transaction) => {
      const order = await this.lockOrder(transaction, creatorId, orderId);
      if (order.status === 'CANCELLED') return order;
      if (order.status !== 'SUBMITTED') {
        throw new AppError(
          'GIFT_ORDER_TRANSITION_INVALID',
          `A ${order.status} order cannot move to CANCELLED.`,
          409,
        );
      }
      const now = this.clock.now();
      const [updated] = await transaction
        .update(giftOrders)
        .set({
          cancelledAt: now,
          cancelReason: normalizedReason,
          status: 'CANCELLED',
          updatedAt: now,
          version: order.version + 1,
        })
        .where(eq(giftOrders.id, order.id))
        .returning();
      await transaction.insert(giftOrderStatusHistory).values({
        actorUserId: context.actorUserId,
        fromStatus: 'SUBMITTED',
        giftOrderId: order.id,
        reason: normalizedReason,
        toStatus: 'CANCELLED',
      });
      await this.audit.record(
        {
          action: 'gift-order.cancelled',
          actorUserId: context.actorUserId,
          afterSummary: { from: 'SUBMITTED', to: 'CANCELLED' },
          creatorId,
          ipAddress: context.ipAddress,
          reason: normalizedReason,
          requestId: context.requestId,
          targetId: order.id,
          targetType: 'gift-order',
        },
        transaction,
      );
      return updated!;
    });
  }

  public async ship(
    creatorId: string,
    orderId: string,
    input: {
      readonly carrierCode: string;
      readonly carrierName: string;
      readonly trackingNumber: string;
      readonly trackingUrl?: string | null;
    },
    context: RequestAuditContext,
  ): Promise<void> {
    const carrierCode = cleanText(input.carrierCode, 80, 'Carrier code');
    const carrierName = cleanText(input.carrierName, 120, 'Carrier name');
    const trackingNumber = cleanText(input.trackingNumber, 160, 'Tracking number');
    let trackingUrl = input.trackingUrl?.trim() || null;
    trackingUrl ??= this.trackingProvider?.buildPublicUrl?.(carrierCode, trackingNumber) ?? null;
    if (trackingUrl) {
      let protocol: string;
      try {
        protocol = new URL(trackingUrl).protocol;
      } catch {
        protocol = '';
      }
      if (!['http:', 'https:'].includes(protocol)) {
        throw new AppError('SHIPMENT_INVALID', 'Tracking URL must use HTTP or HTTPS.', 400);
      }
    }

    await this.database.orm.transaction(async (transaction) => {
      const order = await this.lockOrder(transaction, creatorId, orderId);
      if (order.status !== 'SUBMITTED') {
        throw new AppError(
          'GIFT_ORDER_NOT_SHIPPABLE',
          'Only submitted orders can be shipped.',
          409,
        );
      }
      const now = this.clock.now();
      const shipmentId = randomUUID();
      const [shipment] = await transaction
        .insert(shipments)
        .values({
          carrierCode,
          carrierName,
          creatorId,
          giftOrderId: order.id,
          id: shipmentId,
          nextTrackingRefreshAt: this.trackingProvider ? new Date(now.getTime() + 60_000) : null,
          shipmentNumber: `S-${randomUUID().slice(0, 10).toUpperCase()}`,
          trackingNumber,
          trackingUrl,
        })
        .returning();
      if (!shipment) throw new Error('Shipment insert returned no row.');
      await transaction
        .update(giftOrders)
        .set({
          shippedAt: now,
          status: 'SHIPPED',
          updatedAt: now,
          version: order.version + 1,
        })
        .where(eq(giftOrders.id, order.id));
      await transaction.insert(giftOrderStatusHistory).values({
        actorUserId: context.actorUserId,
        fromStatus: 'SUBMITTED',
        giftOrderId: order.id,
        toStatus: 'SHIPPED',
      });
      await this.audit.record(
        {
          action: 'gift-order.shipped',
          actorUserId: context.actorUserId,
          afterSummary: {
            carrierCode,
            shipmentNumber: shipment.shipmentNumber,
          },
          creatorId,
          ipAddress: context.ipAddress,
          requestId: context.requestId,
          targetId: order.id,
          targetType: 'gift-order',
        },
        transaction,
      );
    });
  }
}
