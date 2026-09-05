import { and, eq } from 'drizzle-orm';

import { AppError } from '../../../shared/errors/app-error.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { AppDatabase, DatabaseService } from '../../infrastructure/db/database.js';
import { giftOrders, giftOrderStatusHistory } from '../../infrastructure/db/schema/index.js';
import { AuditService, type RequestAuditContext } from '../audit/audit-service.js';
import type { ShipGiftInput, CorrectShippingInput } from '../../../shared/contracts/gifts.js';

function cleanText(value: string, maximum: number, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new AppError('SHIPPING_INVALID', `${label} is invalid.`, 400);
  }
  return normalized;
}

export class GiftFulfillmentService {
  private readonly audit: AuditService;

  public constructor(
    private readonly database: DatabaseService,
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
    input: ShipGiftInput,
    context: RequestAuditContext,
  ): Promise<void> {
    const shipping = {
      carrierName: cleanText(input.carrierName, 120, 'Carrier name'),
      trackingNumber: cleanText(input.trackingNumber, 160, 'Tracking number'),
    };
    await this.database.orm.transaction(async (transaction) => {
      const order = await this.lockOrder(transaction, creatorId, orderId);
      if (order.status !== 'SUBMITTED')
        throw new AppError(
          'GIFT_ORDER_NOT_SHIPPABLE',
          'Only submitted orders can be shipped.',
          409,
        );
      const now = this.clock.now();
      await transaction
        .update(giftOrders)
        .set({
          ...shipping,
          shippedAt: now,
          shippedByUserId: context.actorUserId,
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
          afterSummary: shipping,
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

  public async correctShipping(
    creatorId: string,
    orderId: string,
    input: CorrectShippingInput,
    context: RequestAuditContext,
  ): Promise<void> {
    const shipping = {
      carrierName: cleanText(input.carrierName, 120, 'Carrier name'),
      trackingNumber: cleanText(input.trackingNumber, 160, 'Tracking number'),
    };
    await this.database.orm.transaction(async (transaction) => {
      const order = await this.lockOrder(transaction, creatorId, orderId);
      if (order.status !== 'SHIPPED')
        throw new AppError(
          'GIFT_ORDER_NOT_SHIPPED',
          'Only shipped orders have shipping information to correct.',
          409,
        );
      if (order.version !== input.expectedVersion)
        throw new AppError(
          'GIFT_ORDER_VERSION_CONFLICT',
          'This gift changed. Reload it before correcting shipping information.',
          409,
        );
      if (
        order.carrierName === shipping.carrierName &&
        order.trackingNumber === shipping.trackingNumber
      )
        return;
      await transaction
        .update(giftOrders)
        .set({ ...shipping, updatedAt: this.clock.now(), version: order.version + 1 })
        .where(eq(giftOrders.id, order.id));
      await this.audit.record(
        {
          action: 'gift-order.shipping-corrected',
          actorUserId: context.actorUserId,
          beforeSummary: { carrierName: order.carrierName, trackingNumber: order.trackingNumber },
          afterSummary: shipping,
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
