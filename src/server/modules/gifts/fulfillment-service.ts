import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { AppError } from '../../../shared/errors/app-error.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import {
  giftOrders,
  giftOrderStatusHistory,
  shipments,
  type GiftOrderStatus,
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
  ) {
    this.audit = new AuditService(database);
  }

  private async transition(
    creatorId: string,
    orderId: string,
    from: readonly GiftOrderStatus[],
    to: GiftOrderStatus,
    context: RequestAuditContext,
    reason?: string,
  ) {
    return this.database.orm.transaction(async (transaction) => {
      const [order] = await transaction
        .select()
        .from(giftOrders)
        .where(and(eq(giftOrders.id, orderId), eq(giftOrders.creatorId, creatorId)))
        .limit(1)
        .for('update');
      if (!order) throw new AppError('GIFT_ORDER_NOT_FOUND', 'Gift order not found.', 404);
      if (order.status === to) return order;
      if (!from.includes(order.status as GiftOrderStatus)) {
        throw new AppError(
          'GIFT_ORDER_TRANSITION_INVALID',
          `A ${order.status} order cannot move to ${to}.`,
          409,
        );
      }
      const now = new Date();
      const [updated] = await transaction
        .update(giftOrders)
        .set({
          ...(to === 'PROCESSING' ? { processingAt: now } : {}),
          ...(to === 'COMPLETED' ? { completedAt: now } : {}),
          ...(to === 'CANCELLED' ? { cancelReason: reason, cancelledAt: now } : {}),
          status: to,
          updatedAt: now,
          version: order.version + 1,
        })
        .where(eq(giftOrders.id, order.id))
        .returning();
      await transaction.insert(giftOrderStatusHistory).values({
        actorUserId: context.actorUserId,
        fromStatus: order.status,
        giftOrderId: order.id,
        reason,
        toStatus: to,
      });
      await this.audit.record(
        {
          action: `gift-order.${to.toLowerCase()}`,
          actorUserId: context.actorUserId,
          afterSummary: { from: order.status, to },
          creatorId,
          ipAddress: context.ipAddress,
          reason,
          requestId: context.requestId,
          targetId: order.id,
          targetType: 'gift-order',
        },
        transaction,
      );
      return updated!;
    });
  }

  public markProcessing(creatorId: string, orderId: string, context: RequestAuditContext) {
    return this.transition(creatorId, orderId, ['SUBMITTED'], 'PROCESSING', context);
  }

  public complete(creatorId: string, orderId: string, context: RequestAuditContext) {
    return this.transition(creatorId, orderId, ['SHIPPED'], 'COMPLETED', context);
  }

  public cancel(creatorId: string, orderId: string, reason: string, context: RequestAuditContext) {
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 3 || normalizedReason.length > 500) {
      throw new AppError('GIFT_ORDER_CANCEL_REASON_INVALID', 'A cancel reason is required.', 400);
    }
    return this.transition(
      creatorId,
      orderId,
      ['SUBMITTED', 'PROCESSING'],
      'CANCELLED',
      context,
      normalizedReason,
    );
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
      const [order] = await transaction
        .select()
        .from(giftOrders)
        .where(and(eq(giftOrders.id, orderId), eq(giftOrders.creatorId, creatorId)))
        .limit(1)
        .for('update');
      if (!order) throw new AppError('GIFT_ORDER_NOT_FOUND', 'Gift order not found.', 404);
      if (order.status !== 'SUBMITTED' && order.status !== 'PROCESSING') {
        throw new AppError(
          'GIFT_ORDER_NOT_SHIPPABLE',
          'Only submitted or processing orders can be shipped.',
          409,
        );
      }
      const now = new Date();
      if (order.status === 'SUBMITTED') {
        await transaction.insert(giftOrderStatusHistory).values({
          actorUserId: context.actorUserId,
          fromStatus: 'SUBMITTED',
          giftOrderId: order.id,
          toStatus: 'PROCESSING',
        });
      }
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
          processingAt: order.processingAt ?? now,
          shippedAt: now,
          status: 'SHIPPED',
          updatedAt: now,
          version: order.version + 1,
        })
        .where(eq(giftOrders.id, order.id));
      await transaction.insert(giftOrderStatusHistory).values({
        actorUserId: context.actorUserId,
        fromStatus: 'PROCESSING',
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
