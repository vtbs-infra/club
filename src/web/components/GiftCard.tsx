import { ArrowRight, Gift } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { GiftOrderSummary } from '../api/client';
import { formatMonth, relativeDeadline, tierLabel } from '../lib/format';
import {
  giftOrderPresentation,
  shipmentExceptionPresentation,
  shipmentProgressPresentation,
} from '../lib/status-presentation';
import { StatusBadge } from './Ui';

function action(order: GiftOrderSummary): string {
  if (order.status === 'CLAIMABLE') return '现在领取';
  if (order.status === 'SHIPPED') return '查看物流';
  if (order.status === 'SUBMITTED') return '查看进度';
  return '查看详情';
}

function progress(order: GiftOrderSummary, now: number): string {
  const shipment = order.shipment;
  switch (order.status) {
    case 'CLAIMABLE':
      return relativeDeadline(order.release.claimDeadlineAt, now);
    case 'SUBMITTED':
      return '领取信息已提交，等待主播发货';
    case 'SHIPPED':
      return shipment
        ? `${shipment.carrierName} · ${
            shipment.exceptionMessage
              ? shipmentExceptionPresentation.label
              : shipmentProgressPresentation(shipment.progress).label
          }`
        : '已发货，物流信息正在更新';
    case 'COMPLETED':
      return '礼物流程已完成';
    case 'EXPIRED':
      return '未在领取期内提交';
    case 'CANCELLED':
      return '礼物单已取消';
  }
}

export function GiftCard({
  now,
  order,
}: {
  readonly now: number;
  readonly order: GiftOrderSummary;
}) {
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
        <StatusBadge {...giftOrderPresentation[order.status]} />
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
        <p className="gift-progress">{progress(order, now)}</p>
        <Link className="text-action" to={`/gifts/${order.id}`}>
          {action(order)}
          <ArrowRight aria-hidden="true" size={15} />
        </Link>
      </div>
    </article>
  );
}
