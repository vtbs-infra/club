import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';

import { AppError } from '../../../shared/errors/app-error.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import {
  giftOrders,
  giftOrderStatusHistory,
  shipments,
  trackingEvents,
} from '../../infrastructure/db/schema/index.js';
import { AuditService } from '../audit/audit-service.js';
import {
  SHIPMENT_STATUSES,
  type ShipmentStatus,
  type TrackingProvider,
} from './tracking-provider.js';

const TRACKING_PROGRESS: Readonly<Record<Exclude<ShipmentStatus, 'EXCEPTION'>, number>> = {
  DELIVERED: 3,
  IN_TRANSIT: 1,
  LABEL_CREATED: 0,
  OUT_FOR_DELIVERY: 2,
};

function stableStatus(current: ShipmentStatus, incoming: ShipmentStatus): ShipmentStatus {
  if (incoming === 'EXCEPTION' || current === 'EXCEPTION') return incoming;
  return TRACKING_PROGRESS[incoming] >= TRACKING_PROGRESS[current] ? incoming : current;
}

function shipmentStatus(value: string): ShipmentStatus {
  const status = SHIPMENT_STATUSES.find((candidate) => candidate === value);
  if (!status) throw new Error(`Stored shipment has an invalid status: ${value}`);
  return status;
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

export class TrackingRefreshService {
  private readonly audit: AuditService;

  public constructor(
    private readonly database: DatabaseService,
    private readonly provider: TrackingProvider | null,
    private readonly clock: Clock,
  ) {
    this.audit = new AuditService(database);
  }

  public async refreshDue(): Promise<number> {
    if (!this.provider) return 0;
    const due = await this.database.orm
      .select({ shipment: shipments })
      .from(shipments)
      .innerJoin(giftOrders, eq(giftOrders.id, shipments.giftOrderId))
      .where(
        and(
          lte(shipments.nextTrackingRefreshAt, this.clock.now()),
          eq(giftOrders.status, 'SHIPPED'),
          inArray(shipments.status, [
            'LABEL_CREATED',
            'IN_TRANSIT',
            'OUT_FOR_DELIVERY',
            'EXCEPTION',
          ]),
        ),
      )
      .orderBy(asc(shipments.nextTrackingRefreshAt))
      .limit(50);
    let failures = 0;
    for (const row of due) {
      const shipment = row.shipment;
      try {
        const result = await this.provider.query(shipment.carrierCode, shipment.trackingNumber);
        const publicUrl = requireHttpUrl(result.publicUrl);
        await this.database.orm.transaction(async (transaction) => {
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
          const status = stableStatus(shipmentStatus(shipment.status), result.status);
          await transaction
            .update(shipments)
            .set({
              deliveredAt: status === 'DELIVERED' ? now : shipment.deliveredAt,
              exceptionMessage:
                status === 'EXCEPTION'
                  ? (result.events.at(-1)?.description ?? 'Tracking exception')
                  : null,
              lastTrackingError: null,
              lastTrackingRefreshAt: now,
              nextTrackingRefreshAt: status === 'DELIVERED' ? null : result.nextRefreshAt,
              status,
              trackingFailureCount: 0,
              trackingUrl: publicUrl ?? shipment.trackingUrl,
              updatedAt: now,
            })
            .where(eq(shipments.id, shipment.id));
          if (status === 'DELIVERED') {
            const [order] = await transaction
              .select({ status: giftOrders.status, version: giftOrders.version })
              .from(giftOrders)
              .where(eq(giftOrders.id, shipment.giftOrderId))
              .limit(1)
              .for('update');
            if (order?.status === 'SHIPPED') {
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
          }
        });
      } catch (error) {
        failures += 1;
        const message =
          error instanceof Error ? error.message : 'Tracking provider request failed.';
        const now = this.clock.now();
        await this.database.orm
          .update(shipments)
          .set({
            lastTrackingError: message.slice(0, 500),
            lastTrackingRefreshAt: now,
            nextTrackingRefreshAt: new Date(now.getTime() + 30 * 60_000),
            trackingFailureCount: sql`${shipments.trackingFailureCount} + 1`,
          })
          .where(eq(shipments.id, shipment.id));
      }
    }
    if (failures > 0) {
      throw new AppError(
        'TRACKING_REFRESH_FAILED',
        `${failures} tracking refresh request(s) failed.`,
        502,
      );
    }
    return due.length;
  }
}
