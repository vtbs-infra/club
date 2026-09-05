import { sql } from 'drizzle-orm';

import type { GiftOrderStatus } from '../../../shared/contracts/gifts.js';
import { giftOrders, giftReleases } from '../../infrastructure/db/schema/index.js';

export function effectiveOrderStatus(now: Date) {
  return sql<GiftOrderStatus>`case
    when ${giftOrders.status} <> 'UNCLAIMED' then ${giftOrders.status}
    when ${giftReleases.closedAt} is not null
      or ${giftReleases.claimDeadlineAt} <= ${now.toISOString()}::timestamptz then 'EXPIRED'
    when ${giftReleases.claimStartAt} > ${now.toISOString()}::timestamptz then 'UPCOMING'
    else 'CLAIMABLE' end`;
}

export function orderStatusSelection(now: Date) {
  const status = effectiveOrderStatus(now);
  const expiresAt =
    sql<Date>`least(${giftReleases.claimDeadlineAt}, ${giftReleases.closedAt})`.mapWith(
      giftReleases.claimDeadlineAt,
    );
  return {
    status,
    expiresAt,
    expiredAt: sql<Date | null>`case when ${status} = 'EXPIRED' then ${expiresAt} end`.mapWith(
      giftReleases.claimDeadlineAt,
    ),
    expiryReason: sql<'DEADLINE' | 'RELEASE_CLOSED' | null>`case when ${status} = 'EXPIRED' then
      case when ${giftReleases.closedAt} <= ${giftReleases.claimDeadlineAt}
        then 'RELEASE_CLOSED' else 'DEADLINE' end end`,
  };
}
