import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { getCreatorOrders, type GiftOrderStatus } from '../../api/client';
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '../../components/Ui';
import { formatDate, formatMonth, orderStatusLabel, tierLabel } from '../../lib/format';

const filters: readonly { readonly label: string; readonly value?: GiftOrderStatus }[] = [
  { label: '全部' },
  { label: '待领取', value: 'CLAIMABLE' },
  { label: '新提交', value: 'SUBMITTED' },
  { label: '处理中', value: 'PROCESSING' },
  { label: '已发货', value: 'SHIPPED' },
  { label: '已完成', value: 'COMPLETED' },
  { label: '已结束', value: 'EXPIRED' },
];

export function CreatorOrdersPage() {
  const [parameters, setParameters] = useSearchParams();
  const requestedStatus = parameters.get('status') as GiftOrderStatus | null;
  const status = filters.some((filter) => filter.value === requestedStatus)
    ? (requestedStatus ?? undefined)
    : undefined;
  const [search, setSearch] = useState('');
  const orders = useQuery({
    queryFn: () => getCreatorOrders(status),
    queryKey: ['creator', 'orders', status ?? 'all'],
  });
  if (orders.isPending) return <LoadingState label="正在读取礼物单…" />;
  if (orders.isError) return <ErrorState error={orders.error} />;
  const term = search.trim().toLowerCase();
  const visible = term
    ? orders.data.filter(
        (order) =>
          order.orderNumber.toLowerCase().includes(term) ||
          (order.biliDisplayName ?? '').toLowerCase().includes(term) ||
          order.biliUid.includes(term) ||
          order.release.title.toLowerCase().includes(term),
      )
    : orders.data;
  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="GIFT ORDERS"
        intro="按礼物单状态处理领取信息和发货，不需要接触资格或内部发货标识。"
        title="礼物单"
      />
      <div className="order-toolbar">
        <div className="filter-tabs">
          {filters.map((filter) => (
            <button
              className={status === filter.value ? 'active' : ''}
              key={filter.label}
              onClick={() =>
                setParameters(filter.value ? { status: filter.value } : {}, { replace: true })
              }
              type="button"
            >
              {filter.label}
            </button>
          ))}
        </div>
        <label className="search-field">
          <span aria-hidden="true">⌕</span>
          <input
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索昵称、UID 或礼物"
            value={search}
          />
        </label>
      </div>
      {visible.length === 0 ? (
        <EmptyState description="当前筛选条件下没有礼物单。" title="暂无待处理内容" />
      ) : (
        <div className="orders-table-wrap">
          <table className="data-table orders-table">
            <thead>
              <tr>
                <th>用户</th>
                <th>礼物</th>
                <th>资格</th>
                <th>状态</th>
                <th>最近更新</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((order) => (
                <tr key={order.id}>
                  <td>
                    <strong>{order.biliDisplayName}</strong>
                    <small>UID {order.biliUid}</small>
                  </td>
                  <td>
                    <strong>{order.release.title}</strong>
                    <small>{order.orderNumber}</small>
                  </td>
                  <td>
                    <span>{formatMonth(order.release.eligibilityMonth)}</span>
                    <small>{tierLabel[order.tier]}</small>
                  </td>
                  <td>
                    <StatusBadge status={order.status}>
                      {orderStatusLabel[order.status]}
                    </StatusBadge>
                  </td>
                  <td>{formatDate(order.updatedAt, true)}</td>
                  <td>
                    <Link className="row-action" to={`/creator/orders/${order.id}`}>
                      查看 →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
