import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, ClipboardList, Download, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import {
  downloadFulfillmentWorkbook,
  getCreatorOrders,
  type GiftOrderStatus,
} from '../../api/client';
import {
  ConfirmDialog,
  EmptyState,
  ErrorNotice,
  ErrorState,
  InlineNotice,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '../../components/Ui';
import { useNow } from '../../hooks/useNow';
import { formatDate, formatMonth, tierLabel } from '../../lib/format';
import { giftOrderPresentation } from '../../lib/status-presentation';

const filters: readonly { readonly label: string; readonly value?: GiftOrderStatus }[] = [
  { label: '全部' },
  { label: '待领取', value: 'CLAIMABLE' },
  { label: '待发货', value: 'SUBMITTED' },
  { label: '已发货', value: 'SHIPPED' },
  { label: '已完成', value: 'COMPLETED' },
  { label: '已过期', value: 'EXPIRED' },
];

export function CreatorOrdersPage() {
  const now = useNow();
  const [parameters, setParameters] = useSearchParams();
  const requestedStatus = parameters.get('status') as GiftOrderStatus | null;
  const status = filters.some((filter) => filter.value === requestedStatus)
    ? (requestedStatus ?? undefined)
    : undefined;
  const [search, setSearch] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [exportReleaseId, setExportReleaseId] = useState('');
  const [exportedCount, setExportedCount] = useState<number | null>(null);
  const orders = useQuery({
    queryFn: () => getCreatorOrders(),
    queryKey: ['creator', 'orders', 'all'],
  });
  const exportWorkbook = useMutation({
    mutationFn: (releaseId: string) => downloadFulfillmentWorkbook(releaseId),
    onSuccess: ({ blob, filename, rowCount }) => {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename ?? '待发货清单.xlsx';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setExportOpen(false);
      setExportedCount(rowCount);
    },
  });
  if (orders.isPending) return <LoadingState label="正在读取礼物单…" />;
  if (orders.isError) return <ErrorState error={orders.error} />;
  const waitingCounts = new Map<string, number>();
  const waitingReleases = new Map<string, (typeof orders.data)[number]['release']>();
  for (const order of orders.data) {
    if (order.status !== 'SUBMITTED') continue;
    waitingCounts.set(order.release.id, (waitingCounts.get(order.release.id) ?? 0) + 1);
    waitingReleases.set(order.release.id, order.release);
  }
  const exportableReleases = Array.from(waitingReleases.values()).sort((left, right) =>
    right.eligibilityMonth.localeCompare(left.eligibilityMonth),
  );
  const selectedRelease =
    exportableReleases.find((release) => release.id === exportReleaseId) ??
    exportableReleases[0] ??
    null;
  const selectedCount = selectedRelease ? (waitingCounts.get(selectedRelease.id) ?? 0) : 0;
  const term = search.trim().toLowerCase();
  const visible = orders.data.filter(
    (order) =>
      (!status || order.status === status) &&
      (!term ||
        order.orderNumber.toLowerCase().includes(term) ||
        (order.biliDisplayName ?? '').toLowerCase().includes(term) ||
        order.biliUid.includes(term) ||
        order.release.title.toLowerCase().includes(term)),
  );
  return (
    <div className="stack-lg">
      <PageHeader
        actions={
          <button
            className="button secondary"
            disabled={exportableReleases.length === 0}
            onClick={() => {
              exportWorkbook.reset();
              setExportReleaseId(selectedRelease?.id ?? '');
              setExportedCount(null);
              setExportOpen(true);
            }}
            type="button"
          >
            <Download aria-hidden="true" size={16} />
            导出待发货清单
          </button>
        }
        eyebrow="发货履约"
        intro="按礼物单状态处理领取信息和发货，不需要接触资格或内部发货标识。"
        title="礼物单"
      />
      {exportedCount !== null ? (
        <InlineNotice tone="success">已导出 {exportedCount} 条待发货收货信息。</InlineNotice>
      ) : null}
      {exportWorkbook.isError ? <ErrorNotice error={exportWorkbook.error} /> : null}
      <div className="order-toolbar">
        <div aria-label="按礼物单状态筛选" className="filter-tabs" role="group">
          {filters.map((filter) => (
            <button
              aria-pressed={status === filter.value}
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
          <span className="sr-only">搜索礼物单</span>
          <Search aria-hidden="true" size={17} />
          <input
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索昵称、UID 或礼物"
            value={search}
          />
        </label>
      </div>
      {visible.length === 0 ? (
        <EmptyState
          description="当前筛选条件下没有礼物单。"
          icon={ClipboardList}
          title="没有符合条件的礼物单"
        />
      ) : (
        <div className="orders-table-wrap">
          <table className="data-table orders-table">
            <caption className="sr-only">主播礼物单列表</caption>
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
                    <StatusBadge {...giftOrderPresentation[order.status]} />
                  </td>
                  <td>{formatDate(order.updatedAt, true)}</td>
                  <td>
                    <Link className="row-action" to={`/creator/orders/${order.id}`}>
                      查看
                      <ArrowRight aria-hidden="true" size={14} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        busy={exportWorkbook.isPending}
        confirmDisabled={!selectedRelease || selectedCount === 0}
        confirmLabel={`导出 ${selectedCount} 条`}
        description={
          <div className="stack-md">
            <label>
              礼物发布
              <select
                onChange={(event) => setExportReleaseId(event.target.value)}
                value={selectedRelease?.id ?? ''}
              >
                {exportableReleases.map((release) => (
                  <option key={release.id} value={release.id}>
                    {formatMonth(release.eligibilityMonth)} · {release.title} ·{' '}
                    {waitingCounts.get(release.id)} 条
                  </option>
                ))}
              </select>
            </label>
            <p>文件只包含该礼物发布当前处于“待发货”的礼物单，导出不会改变订单状态。</p>
            {selectedRelease && new Date(selectedRelease.claimDeadlineAt).getTime() > now ? (
              <InlineNotice tone="warning">
                领取仍在进行，之后提交的用户不会包含在本次文件中。
              </InlineNotice>
            ) : null}
            <p>文件包含完整收件人、电话和地址，请仅用于本次礼物发货。</p>
          </div>
        }
        onCancel={() => {
          if (!exportWorkbook.isPending) {
            exportWorkbook.reset();
            setExportOpen(false);
          }
        }}
        onConfirm={() => {
          if (selectedRelease) exportWorkbook.mutate(selectedRelease.id);
        }}
        open={exportOpen}
        title="导出待发货清单"
      />
    </div>
  );
}
