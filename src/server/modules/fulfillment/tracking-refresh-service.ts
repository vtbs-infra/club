import { asc, eq, sql } from 'drizzle-orm';

import { AppError } from '../../../shared/errors/app-error.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { AppDatabase, DatabaseService } from '../../infrastructure/db/database.js';
import {
  giftOrders,
  giftOrderStatusHistory,
  shipments,
  trackingEvents,
} from '../../infrastructure/db/schema/index.js';
import { AuditService } from '../audit/audit-service.js';
import { trackingRefreshDueCondition } from './tracking-refresh-policy.js';
import {
  SHIPMENT_PROGRESS_STATES,
  type ShipmentProgress,
  type TrackingProvider,
  type TrackingResult,
  type TrackingStatus,
} from './tracking-provider.js';

const TRACKING_PROGRESS: Readonly<Record<ShipmentProgress, number>> = {
  DELIVERED: 3,
  IN_TRANSIT: 1,
  LABEL_CREATED: 0,
  OUT_FOR_DELIVERY: 2,
};

function stableProgress(current: ShipmentProgress, incoming: TrackingStatus): ShipmentProgress {
  if (incoming === 'EXCEPTION') return current;
  return TRACKING_PROGRESS[incoming] >= TRACKING_PROGRESS[current] ? incoming : current;
}

function shipmentProgress(value: string): ShipmentProgress {
  const progress = SHIPMENT_PROGRESS_STATES.find((candidate) => candidate === value);
  if (!progress) throw new Error(`Stored shipment has invalid progress: ${value}`);
  return progress;
}

function requireHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  let protocol: string;
  try {
    protocol = new URL(value).protocol;
  } catch {
    protocol = '';
  }
  if (!['http:', 'https:'].includes(protocol)) {
    throw new Error('Tracking provider returned a non-HTTP public URL.');
  }
  return value;
}

function nextExceptionMessage(
  currentProgress: ShipmentProgress,
  currentMessage: string | null,
  result: TrackingResult,
): string | null {
  if (result.status === 'EXCEPTION') {
    return (
      result.events.findLast((event) => event.status === 'EXCEPTION')?.description ??
      'Tracking exception'
    ).slice(0, 500);
  }
  return TRACKING_PROGRESS[result.status] >= TRACKING_PROGRESS[currentProgress]
    ? null
    : currentMessage;
}

type ShipmentRow = typeof shipments.$inferSelect;

interface LockedRefresh {
  readonly order: { readonly status: string; readonly version: number };
  readonly shipment: ShipmentRow;
}

export class TrackingRefreshService {
  private readonly audit: AuditService;

  public constructor(
    private readonly database: DatabaseService,
    private readonly provider: TrackingProvider | null,
    private readonly clock: Clock,
  ) {
    this.audit = new AuditService(database);
  }

  private async lockDueShipment(
    transaction: AppDatabase,
    candidate: ShipmentRow,
  ): Promise<LockedRefresh | null> {
    const [order] = await transaction
      .select({ status: giftOrders.status, version: giftOrders.version })
      .from(giftOrders)
      .where(eq(giftOrders.id, candidate.giftOrderId))
      .limit(1)
      .for('update');
    const [shipment] = await transaction
      .select()
      .from(shipments)
      .where(eq(shipments.id, candidate.id))
      .limit(1)
      .for('update');
    if (!order || !shipment) {
      throw new Error('A due tracking refresh no longer has its order or shipment.');
    }

    const now = this.clock.now();
    if (order.status !== 'SHIPPED') {
      if (shipment.nextTrackingRefreshAt) {
        await transaction
          .update(shipments)
          .set({ nextTrackingRefreshAt: null, updatedAt: now })
          .where(eq(shipments.id, shipment.id));
      }
      return null;
    }
    if (!shipment.nextTrackingRefreshAt || shipment.nextTrackingRefreshAt > now) return null;
    return { order, shipment };
  }

  private async applyResult(
    candidate: ShipmentRow,
    result: TrackingResult,
    publicUrl: string | null,
  ): Promise<boolean> {
    return this.database.orm.transaction(async (transaction) => {
      const locked = await this.lockDueShipment(transaction, candidate);
      if (!locked) return false;
      const { order, shipment } = locked;
      if (result.events.length > 0) {
        await transaction
          .insert(trackingEvents)
          .values(
            result.events.map((event) => ({
              description: event.description,
              location: event.location,
              occurredAt: event.occurredAt,
              providerEventId: event.id,
              shipmentId: shipment.id,
              status: event.status,
            })),
          )
          .onConflictDoNothing();
      }

      const now = this.clock.now();
      const currentProgress = shipmentProgress(shipment.progress);
      const progress = stableProgress(currentProgress, result.status);
      await transaction
        .update(shipments)
        .set({
          deliveredAt: progress === 'DELIVERED' ? now : null,
          exceptionMessage: nextExceptionMessage(
            currentProgress,
            shipment.exceptionMessage,
            result,
          ),
          lastTrackingError: null,
          lastTrackingRefreshAt: now,
          nextTrackingRefreshAt: progress === 'DELIVERED' ? null : result.nextRefreshAt,
          progress,
          trackingFailureCount: 0,
          trackingUrl: publicUrl ?? shipment.trackingUrl,
          updatedAt: now,
        })
        .where(eq(shipments.id, shipment.id));

      if (progress === 'DELIVERED') {
        await transaction
          .update(giftOrders)
          .set({
            completedAt: now,
            status: 'COMPLETED',
            updatedAt: now,
            version: order.version + 1,
          })
          .where(eq(giftOrders.id, shipment.giftOrderId));
        await transaction.insert(giftOrderStatusHistory).values({
          fromStatus: 'SHIPPED',
          giftOrderId: shipment.giftOrderId,
          reason: 'Tracking provider reported delivery.',
          toStatus: 'COMPLETED',
        });
        await this.audit.record(
          {
            action: 'gift-order.completed',
            actorUserId: null,
            afterSummary: { from: 'SHIPPED', source: 'TRACKING', to: 'COMPLETED' },
            creatorId: shipment.creatorId,
            reason: 'Tracking provider reported delivery.',
            targetId: shipment.giftOrderId,
            targetType: 'gift-order',
          },
          transaction,
        );
      }
      return true;
    });
  }

  private async recordFailure(candidate: ShipmentRow, error: unknown): Promise<boolean> {
    const message = error instanceof Error ? error.message : 'Tracking provider request failed.';
    return this.database.orm.transaction(async (transaction) => {
      const locked = await this.lockDueShipment(transaction, candidate);
      if (!locked) return false;
      const now = this.clock.now();
      await transaction
        .update(shipments)
        .set({
          lastTrackingError: message.slice(0, 500),
          lastTrackingRefreshAt: now,
          nextTrackingRefreshAt: new Date(now.getTime() + 30 * 60_000),
          trackingFailureCount: sql`${shipments.trackingFailureCount} + 1`,
          updatedAt: now,
        })
        .where(eq(shipments.id, locked.shipment.id));
      return true;
    });
  }

  public async refreshDue(): Promise<number> {
    if (!this.provider) return 0;
    const due = await this.database.orm
      .select({ shipment: shipments })
      .from(shipments)
      .innerJoin(giftOrders, eq(giftOrders.id, shipments.giftOrderId))
      .where(trackingRefreshDueCondition(this.clock.now()))
      .orderBy(asc(shipments.nextTrackingRefreshAt))
      .limit(50);
    let failures = 0;
    let refreshed = 0;
    for (const row of due) {
      let publicUrl: string | null;
      let result: TrackingResult;
      try {
        result = await this.provider.query(row.shipment.carrierCode, row.shipment.trackingNumber);
        publicUrl = requireHttpUrl(result.publicUrl);
      } catch (error) {
        if (await this.recordFailure(row.shipment, error)) failures += 1;
        continue;
      }
      if (await this.applyResult(row.shipment, result, publicUrl)) refreshed += 1;
    }
    if (failures > 0) {
      throw new AppError(
        'TRACKING_REFRESH_FAILED',
        `${failures} tracking refresh request(s) failed.`,
        502,
      );
    }
    return refreshed;
  }
}
