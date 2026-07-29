import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';

import { AppError } from '../../../shared/errors/app-error.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import {
  giftOrders,
  giftOrderStatusHistory,
  shipments,
  trackingEvents,
} from '../../infrastructure/db/schema/index.js';
import type { TrackingProvider } from './tracking-provider.js';

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
  public constructor(
    private readonly database: DatabaseService,
    private readonly provider: TrackingProvider | null,
  ) {}

  public async refreshDue(): Promise<number> {
    if (!this.provider) return 0;
    const due = await this.database.orm
      .select()
      .from(shipments)
      .where(
        and(
          lte(shipments.nextTrackingRefreshAt, new Date()),
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
    for (const shipment of due) {
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
          const now = new Date();
          await transaction
            .update(shipments)
            .set({
              deliveredAt: result.status === 'DELIVERED' ? now : shipment.deliveredAt,
              exceptionMessage:
                result.status === 'EXCEPTION'
                  ? (result.events.at(-1)?.description ?? 'Tracking exception')
                  : null,
              lastTrackingError: null,
              lastTrackingRefreshAt: now,
              nextTrackingRefreshAt: result.nextRefreshAt,
              status: result.status,
              trackingFailureCount: 0,
              trackingUrl: publicUrl ?? shipment.trackingUrl,
              updatedAt: now,
            })
            .where(eq(shipments.id, shipment.id));
          if (result.status === 'DELIVERED') {
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
            }
          }
        });
      } catch (error) {
        failures += 1;
        const message =
          error instanceof Error ? error.message : 'Tracking provider request failed.';
        await this.database.orm
          .update(shipments)
          .set({
            lastTrackingError: message.slice(0, 500),
            lastTrackingRefreshAt: new Date(),
            nextTrackingRefreshAt: new Date(Date.now() + 30 * 60_000),
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
