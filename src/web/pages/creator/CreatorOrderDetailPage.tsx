import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, PackageCheck, XCircle } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  cancelCreatorOrder,
  correctCreatorOrderShipping,
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
import { formatDate, formatMonth, tierLabel } from '../../lib/format';
import { giftOrderPresentation } from '../../lib/status-presentation';
import { ShippingDetails } from '../../components/ShippingDetails';

const carrierNames = [
  'EMS',
  '京东物流',
  '圆通速递',
  '申通快递',
  '顺丰速运',
  '韵达快递',
  '中通快递',
];

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
  const [shippingValidationError, setShippingValidationError] = useState<string | null>(null);
  const [shipOpen, setShipOpen] = useState(false);
  const [editingShipping, setEditingShipping] = useState(false);
  const [shippingVersion, setShippingVersion] = useState(0);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const update = async (updated: Awaited<ReturnType<typeof getCreatorOrder>>) => {
    queryClient.setQueryData(['creator', 'orders', giftOrderId], updated);
    await queryClient.invalidateQueries({ queryKey: ['creator', 'orders'] });
  };
  const ship = useMutation({
    mutationFn: () => {
      const input = { carrierName: carrierName.trim(), trackingNumber: trackingNumber.trim() };
      return editingShipping
        ? correctCreatorOrderShipping(giftOrderId, { ...input, expectedVersion: shippingVersion })
        : shipCreatorOrder(giftOrderId, input);
    },
    onSuccess: async (updated) => {
      setShipOpen(false);
      setEditingShipping(false);
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
  const mutationError = ship.error ?? cancel.error;
  const operationPending = ship.isPending || cancel.isPending;
  return (
    <div className="stack-lg">
      <Link className="back-link" to="/creator/orders">
        <ArrowLeft aria-hidden="true" size={16} />
        返回礼物单
      </Link>
      <header className="order-detail-header">
        <div>
          <div className="detail-status-row">
            <StatusBadge {...giftOrderPresentation[data.status]} />
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
                cancel.reset();
                setCarrierName(data.shipping!.carrierName);
                setTrackingNumber(data.shipping!.trackingNumber);
                setShippingVersion(data.version);
                setEditingShipping(true);
              }}
              type="button"
            >
              更正发货信息
              <Pencil aria-hidden="true" size={16} />
            </button>
          ) : null}
          {data.status === 'SUBMITTED' ? (
            <button
              className="button ghost danger"
              disabled={operationPending}
              onClick={() => {
                ship.reset();
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
                <dd>{giftOrderPresentation[data.status].label}</dd>
              </div>
            </dl>
          </section>
          {data.status === 'SUBMITTED' || editingShipping ? (
            <form
              className="panel shipping-form"
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                if (!carrierName.trim() || !trackingNumber.trim()) {
                  setShippingValidationError('快递公司和运单号不能只包含空格。');
                  return;
                }
                setShippingValidationError(null);
                ship.reset();
                cancel.reset();
                setShipOpen(true);
              }}
            >
              <div>
                <p className="eyebrow">发货操作</p>
                <h2>{editingShipping ? '更正发货信息' : '录入发货信息'}</h2>
                <p>填写用户能识别的快递名称和运单号即可。</p>
              </div>
              <label>
                快递公司
                <input
                  list="carrier-options"
                  maxLength={120}
                  onChange={(event) => {
                    setShippingValidationError(null);
                    setCarrierName(event.target.value);
                  }}
                  placeholder="例如：中通快递"
                  required
                  value={carrierName}
                />
                <datalist id="carrier-options">
                  {carrierNames.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </label>
              <label>
                运单号
                <input
                  maxLength={160}
                  onChange={(event) => {
                    setShippingValidationError(null);
                    setTrackingNumber(event.target.value);
                  }}
                  required
                  value={trackingNumber}
                />
              </label>
              {shippingValidationError ? (
                <InlineNotice tone="danger">
                  <p>{shippingValidationError}</p>
                </InlineNotice>
              ) : null}
              <button className="button primary wide" disabled={operationPending} type="submit">
                {editingShipping ? '保存更正' : '确认发货'}
                <PackageCheck aria-hidden="true" size={16} />
              </button>
              {editingShipping ? (
                <button
                  className="button secondary wide"
                  disabled={operationPending}
                  onClick={() => setEditingShipping(false)}
                  type="button"
                >
                  取消更正
                </button>
              ) : null}
            </form>
          ) : data.shipping ? (
            <section className="panel shipping-summary">
              <p className="eyebrow">发货记录</p>
              <h2>发货信息</h2>
              {data.shippedAt ? <p>{formatDate(data.shippedAt, true)}</p> : null}
              <ShippingDetails shipping={data.shipping} />
            </section>
          ) : null}
        </aside>
      </div>
      <ConfirmDialog
        busy={ship.isPending}
        confirmLabel={editingShipping ? '保存更正' : '确认发货'}
        description={
          <div className="stack-md">
            <p>
              {editingShipping
                ? '用户将看到更正后的发货信息，本次修改会保留审计记录。'
                : '提交后礼物单会进入已发货状态，用户将立即看到以下发货信息。'}
            </p>
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
        title={editingShipping ? '核对并更正发货信息' : '核对并提交发货信息'}
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
