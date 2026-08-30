import { and, eq, inArray, isNotNull, lte, type SQL } from 'drizzle-orm';

import { giftOrders, shipments } from '../../infrastructure/db/schema/index.js';

export const REFRESHABLE_SHIPMENT_PROGRESS = [
  'LABEL_CREATED',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
] as const;

export function trackingRefreshDueCondition(now: Date): SQL {
  return and(
    eq(giftOrders.status, 'SHIPPED'),
    inArray(shipments.progress, REFRESHABLE_SHIPMENT_PROGRESS),
    isNotNull(shipments.nextTrackingRefreshAt),
    lte(shipments.nextTrackingRefreshAt, now),
  )!;
}
