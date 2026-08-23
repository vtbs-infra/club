import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CircleCheck, ExternalLink, PackageCheck, XCircle } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  cancelCreatorOrder,
  completeCreatorOrder,
  getCreatorOrder,
  shipCreatorOrder,
} from '../../api/client';
import {
  ConfirmDialog,
  ErrorNotice,
  ErrorState,
  InlineNotice,
  LoadingState,
  StatusBadge,
} from '../../components/Ui';
import { formatDate, formatMonth, orderStatusLabel, tierLabel } from '../../lib/format';

const carrierCodes: Readonly<Record<string, string>> = {
  EMS: 'EMS',
  京东物流: 'JD',
  圆通速递: 'YTO',
  申通快递: 'STO',
  顺丰速运: 'SF',
  韵达快递: 'YD',
  中通快递: 'ZTO',
};

const shipmentStatusLabel: Readonly<Record<string, string>> = {
  DELIVERED: '已送达',
  EXCEPTION: '物流异常',
  IN_TRANSIT: '运输中',
  LABEL_CREATED: '已录单',
  OUT_FOR_DELIVERY: '派送中',
};

export function CreatorOrderDetailPage() {
  const { giftOrderId = '' } = useParams();
  const queryClient = useQueryClient();
  const order = useQuery({
    enabled: Boolean(giftOrderId),
    queryFn: () => getCreatorOrder(giftOrderId),
    queryKey: ['creator', 'orders', giftOrderId],
  });
  const [carrierName, setCarrierName] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [trackingUrl, setTrackingUrl] = useState('');
  const [shipmentValidationError, setShipmentValidationError] = useState<string | null>(null);
  const [shipOpen, setShipOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const update = async (updated: Awaited<ReturnType<typeof getCreatorOrder>>) => {
    queryClient.setQueryData(['creator', 'orders', giftOrderId], updated);
    await queryClient.invalidateQueries({ queryKey: ['creator', 'orders'] });
  };
  const ship = useMutation({
    mutationFn: () =>
      shipCreatorOrder(giftOrderId, {
        carrierCode: carrierCodes[carrierName.trim()] ?? 'OTHER',
        carrierName: carrierName.trim(),
        trackingNumber: trackingNumber.trim(),
        ...(trackingUrl.trim() ? { trackingUrl: trackingUrl.trim() } : {}),
      }),
    onSuccess: async (updated) => {
      setShipOpen(false);
      await update(updated);
    },
  });
  const complete = useMutation({
    mutationFn: () => completeCreatorOrder(giftOrderId),
    onSuccess: async (updated) => {
      setCompleteOpen(false);
      await update(updated);
    },
  });
  const cancel = useMutation({
    mutationFn: (reason: string) => cancelCreatorOrder(giftOrderId, reason),
    onSuccess: async (updated) => {
      setCancelOpen(false);
      setCancelReason('');
      await update(updated);
    },
  });

  if (order.isPending) return <LoadingState label="正在读取礼物单…" />;
  if (order.isError || !order.data) return <ErrorState error={order.error} />;
  const data = order.data;
  const mutationError = ship.error ?? complete.error ?? cancel.error;
  const operationPending = ship.isPending || complete.isPending || cancel.isPending;
  return (
    <div className="stack-lg">
      <Link className="back-link" to="/creator/orders">
        <ArrowLeft aria-hidden="true" size={16} />
        返回礼物单
      </Link>
      <header className="order-detail-header">
        <div>
          <div className="detail-status-row">
            <StatusBadge status={data.status}>{orderStatusLabel[data.status]}</StatusBadge>
            <span>{data.orderNumber}</span>
          </div>
          <h1>{data.release.title}</h1>
          <p>
            {data.biliDisplayName} · UID {data.biliUid} · {tierLabel[data.tier]}
          </p>
        </div>
        <div className="page-actions">
          {data.status === 'SHIPPED' ? (
            <button
              className="button secondary"
              disabled={operationPending}
              onClick={() => {
                ship.reset();
                complete.reset();
                cancel.reset();
                setCompleteOpen(true);
              }}
              type="button"
            >
              标记已完成
              <CircleCheck aria-hidden="true" size={16} />
            </button>
          ) : null}
          {data.status === 'SUBMITTED' ? (
            <button
              className="button ghost danger"
              disabled={operationPending}
              onClick={() => {
                ship.reset();
                complete.reset();
                cancel.reset();
                setCancelOpen(true);
              }}
              type="button"
            >
              取消礼物单
              <XCircle aria-hidden="true" size={16} />
            </button>
          ) : null}
        </div>
      </header>
      {mutationError ? <ErrorNotice error={mutationError} /> : null}
      <div className="order-detail-grid">
        <div className="stack-lg">
          <section className="panel">
            <div className="section-heading compact">
              <div>
                <p className="eyebrow">收件人</p>
                <h2>收货信息</h2>
              </div>
            </div>
            {data.deliveryAddress ? (
              <div className="recipient-card">
                <div>
                  <strong>{data.deliveryAddress.recipientName}</strong>
                  <span>{data.deliveryAddress.phone}</span>
                </div>
                <p>
                  {data.deliveryAddress.countryRegion} {data.deliveryAddress.province}
                  {data.deliveryAddress.city}
                  {data.deliveryAddress.district}
                  {data.deliveryAddress.detailedAddress}
                </p>
                {data.deliveryAddress.postalCode ? (
                  <small>邮编 {data.deliveryAddress.postalCode}</small>
                ) : null}
                {data.deliveryAddress.userNote ? (
                  <div className="recipient-note">备注：{data.deliveryAddress.userNote}</div>
                ) : null}
              </div>
            ) : (
              <p className="quiet-line">用户尚未提交领取信息。</p>
            )}
          </section>
          {data.optionValues.length > 0 ? (
            <section className="panel">
              <div className="section-heading compact">
                <div>
                  <p className="eyebrow">礼物选项</p>
                  <h2>用户填写内容</h2>
                </div>
              </div>
              <dl className="option-values">
                {data.optionValues.map((option) => (
                  <div key={option.key}>
                    <dt>{option.label}</dt>
                    <dd>
                      {typeof option.value === 'boolean'
                        ? option.value
                          ? '已确认'
                          : '未确认'
                        : option.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}
          <section className="panel">
            <div className="section-heading compact">
              <div>
                <p className="eyebrow">礼包内容</p>
                <h2>礼物内容</h2>
              </div>
            </div>
            <div className="package-list compact">
              {data.items.map((package_) => (
                <article key={package_.id}>
                  <div>
                    <strong>{package_.name}</strong>
                    <p>{package_.description}</p>
                  </div>
                  <ul>
                    {package_.items.map((item) => (
                      <li key={item.name}>
                        <span>{item.name}</span>
                        <strong>× {item.quantity}</strong>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>
        </div>
        <aside className="stack-lg">
          <section className="panel order-summary-card">
            <h2>礼物单摘要</h2>
            <dl>
              <div>
                <dt>资格月份</dt>
                <dd>{formatMonth(data.release.eligibilityMonth)}</dd>
              </div>
              <div>
                <dt>大航海等级</dt>
                <dd>{tierLabel[data.tier]}</dd>
              </div>
              <div>
                <dt>提交时间</dt>
                <dd>{data.submittedAt ? formatDate(data.submittedAt, true) : '尚未提交'}</dd>
              </div>
              <div>
                <dt>当前状态</dt>
                <dd>{orderStatusLabel[data.status]}</dd>
              </div>
            </dl>
          </section>
          {data.status === 'SUBMITTED' ? (
            <form
              className="panel shipment-form"
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                if (!carrierName.trim() || !trackingNumber.trim()) {
                  setShipmentValidationError('快递公司和运单号不能只包含空格。');
                  return;
                }
                setShipmentValidationError(null);
                ship.reset();
                complete.reset();
                cancel.reset();
                setShipOpen(true);
              }}
            >
              <div>
                <p className="eyebrow">发货操作</p>
                <h2>录入发货信息</h2>
                <p>填写用户能识别的快递名称和运单号即可。</p>
              </div>
              <label>
                快递公司
                <input
                  list="carrier-options"
                  maxLength={120}
                  onChange={(event) => {
                    setShipmentValidationError(null);
                    setCarrierName(event.target.value);
                  }}
                  placeholder="例如：中通快递"
                  required
                  value={carrierName}
                />
                <datalist id="carrier-options">
                  {Object.keys(carrierCodes).map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </label>
              <label>
                运单号
                <input
                  maxLength={160}
                  onChange={(event) => {
                    setShipmentValidationError(null);
                    setTrackingNumber(event.target.value);
                  }}
                  required
                  value={trackingNumber}
                />
              </label>
              <label>
                查询链接（可选）
                <input
                  maxLength={1_000}
                  onChange={(event) => {
                    setShipmentValidationError(null);
                    setTrackingUrl(event.target.value);
                  }}
                  placeholder="https://…"
                  type="url"
                  value={trackingUrl}
                />
              </label>
              {shipmentValidationError ? (
                <InlineNotice tone="danger">
                  <p>{shipmentValidationError}</p>
                </InlineNotice>
              ) : null}
              <button className="button primary wide" disabled={operationPending} type="submit">
                确认发货
                <PackageCheck aria-hidden="true" size={16} />
              </button>
            </form>
          ) : data.shipments.length > 0 ? (
            <section className="panel shipment-summary">
              <p className="eyebrow">物流信息</p>
              <h2>物流信息</h2>
              {data.shipments.map((shipment) => (
                <div key={shipment.id}>
                  <strong>{shipment.carrierName}</strong>
                  <p>{shipment.trackingNumber}</p>
                  <StatusBadge status={shipment.status}>
                    {shipmentStatusLabel[shipment.status] ?? '状态更新中'}
                  </StatusBadge>
                  {shipment.trackingUrl ? (
                    <a href={shipment.trackingUrl} rel="noreferrer" target="_blank">
                      查询物流
                      <ExternalLink aria-hidden="true" size={14} />
                    </a>
                  ) : null}
                </div>
              ))}
            </section>
          ) : null}
        </aside>
      </div>
      <ConfirmDialog
        busy={ship.isPending}
        confirmLabel="确认发货"
        description={
          <div className="stack-md">
            <p>提交后礼物单会进入已发货状态，用户将立即看到以下物流信息。</p>
            <dl className="dialog-summary">
              <div>
                <dt>快递公司</dt>
                <dd>{carrierName.trim()}</dd>
              </div>
              <div>
                <dt>运单号</dt>
                <dd>{trackingNumber.trim()}</dd>
              </div>
            </dl>
            {ship.isError ? <ErrorNotice error={ship.error} /> : null}
          </div>
        }
        onCancel={() => setShipOpen(false)}
        onConfirm={() => ship.mutate()}
        open={shipOpen}
        title="核对并提交发货信息"
      />
      <ConfirmDialog
        busy={complete.isPending}
        confirmLabel="标记已完成"
        description={
          <div className="stack-md">
            <p>礼物单会结束当前履约流程。请仅在确认无需继续跟进物流时执行。</p>
            {complete.isError ? <ErrorNotice error={complete.error} /> : null}
          </div>
        }
        onCancel={() => setCompleteOpen(false)}
        onConfirm={() => complete.mutate()}
        open={completeOpen}
        title="确认将礼物单标记为已完成？"
      />
      <ConfirmDialog
        busy={cancel.isPending}
        confirmDisabled={cancelReason.trim().length < 3}
        confirmLabel="取消礼物单"
        description={
          <div className="stack-md">
            <label>
              取消原因
              <textarea
                maxLength={500}
                onChange={(event) => setCancelReason(event.target.value)}
                placeholder="用户会在礼物单中看到已取消状态"
                rows={4}
                value={cancelReason}
              />
            </label>
            {cancel.isError ? <ErrorNotice error={cancel.error} /> : null}
          </div>
        }
        onCancel={() => setCancelOpen(false)}
        onConfirm={() => cancel.mutate(cancelReason.trim())}
        open={cancelOpen}
        title="确认取消这张礼物单？"
        tone="danger"
      />
    </div>
  );
}
