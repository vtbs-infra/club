import { ArrowRight, Gift } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { GiftOrder } from '../api/client';
import { formatMonth, orderStatusLabel, relativeDeadline, tierLabel } from '../lib/format';
import { StatusBadge } from './Ui';

function action(order: GiftOrder): string {
  if (order.status === 'CLAIMABLE') return '现在领取';
  if (order.status === 'SHIPPED') return '查看物流';
  if (order.status === 'SUBMITTED') return '查看进度';
  return '查看详情';
}

export function GiftCard({ order }: { readonly order: GiftOrder }) {
  const shipment = order.shipments[0];
  return (
    <article className={`gift-card gift-${order.status.toLowerCase()}`}>
      <div className="gift-art">
        {order.release.coverImageUrl ? (
          <img alt="" src={order.release.coverImageUrl} />
        ) : (
          <div className="gift-placeholder" aria-hidden="true">
            <span>
              <Gift size={42} strokeWidth={1.55} />
            </span>
            <small>舰长礼物</small>
          </div>
        )}
        <StatusBadge status={order.status}>{orderStatusLabel[order.status]}</StatusBadge>
      </div>
      <div className="gift-copy">
        <div className="gift-creator">
          <span className="mini-avatar">{order.creator.displayName.slice(0, 1)}</span>
          <span>{order.creator.displayName}</span>
        </div>
        <h3>{order.release.title}</h3>
        <p className="gift-meta">
          {formatMonth(order.release.eligibilityMonth)} · {tierLabel[order.tier]}
        </p>
        <p className="gift-progress">
          {order.status === 'CLAIMABLE'
            ? relativeDeadline(order.release.claimDeadlineAt)
            : shipment
              ? `${shipment.carrierName} · ${shipment.status === 'DELIVERED' ? '已签收' : '运输中'}`
              : order.status === 'SUBMITTED'
                ? '领取信息已提交，等待主播发货'
                : order.status === 'EXPIRED'
                  ? '未在领取期内提交'
                  : '状态更新后会在这里显示'}
        </p>
        <Link className="text-action" to={`/gifts/${order.id}`}>
          {action(order)}
          <ArrowRight aria-hidden="true" size={15} />
        </Link>
      </div>
    </article>
  );
}
