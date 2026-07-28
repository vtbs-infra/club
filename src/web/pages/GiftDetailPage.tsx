import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';

import { getAddresses, getMyGift, submitGift, type AddressRecord } from '../api/client';
import { AddressForm } from '../components/AddressEditor';
import { ErrorState, InlineNotice, LoadingState, StatusBadge } from '../components/Ui';
import { formatDate, formatMonth, orderStatusLabel, tierLabel } from '../lib/format';

export function GiftDetailPage() {
  const { giftOrderId = '' } = useParams();
  const queryClient = useQueryClient();
  const gift = useQuery({
    enabled: Boolean(giftOrderId),
    queryFn: () => getMyGift(giftOrderId),
    queryKey: ['gifts', 'mine', giftOrderId],
  });
  const addresses = useQuery({
    enabled: gift.data?.status === 'CLAIMABLE',
    queryFn: getAddresses,
    queryKey: ['me', 'addresses'],
  });
  const [addressId, setAddressId] = useState('');
  const [addingAddress, setAddingAddress] = useState(false);
  const [options, setOptions] = useState<Record<string, boolean | string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const effectiveAddressId =
    addressId ||
    addresses.data?.find((address) => address.isDefault)?.id ||
    addresses.data?.[0]?.id ||
    '';
  const submit = useMutation({
    mutationFn: () =>
      submitGift(giftOrderId, {
        addressId: effectiveAddressId,
        expectedVersion: gift.data!.version,
        options,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['gifts'] }),
        queryClient.invalidateQueries({ queryKey: ['me', 'announcements'] }),
      ]);
      window.scrollTo({ behavior: 'smooth', top: 0 });
    },
  });

  if (gift.isPending) return <LoadingState label="正在读取礼物详情…" />;
  if (gift.isError || !gift.data) return <ErrorState error={gift.error} />;
  const order = gift.data;
  const selectedAddress = addresses.data?.find((address) => address.id === effectiveAddressId);
  const claimNotStarted = new Date(order.release.claimStartAt) > new Date();

  return (
    <div className="gift-detail stack-lg">
      <Link className="back-link" to="/gifts">
        ← 返回礼物单
      </Link>
      <section className="gift-detail-hero">
        <div className="detail-art">
          {order.release.coverImageUrl ? (
            <img alt="" src={order.release.coverImageUrl} />
          ) : (
            <div className="gift-placeholder">
              <span>✦</span>
              <small>GUARD GIFT</small>
            </div>
          )}
        </div>
        <div className="detail-copy">
          <div className="detail-status-row">
            <StatusBadge status={order.status}>{orderStatusLabel[order.status]}</StatusBadge>
            <span>{formatMonth(order.release.eligibilityMonth)}</span>
          </div>
          <p className="eyebrow">{order.creator.displayName}</p>
          <h1>{order.release.title}</h1>
          <p>{order.release.description || '这是一份属于你的舰长礼物。'}</p>
          <dl className="detail-facts">
            <div>
              <dt>资格等级</dt>
              <dd>{tierLabel[order.tier]}</dd>
            </div>
            <div>
              <dt>领取截止</dt>
              <dd>{formatDate(order.release.claimDeadlineAt, true)}</dd>
            </div>
            <div>
              <dt>礼物单号</dt>
              <dd>{order.orderNumber}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="panel gift-content-panel">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">INCLUDED</p>
            <h2>礼物内容</h2>
          </div>
        </div>
        <div className="package-list">
          {order.items.map((package_) => (
            <article key={package_.id}>
              <div>
                <strong>{package_.name}</strong>
                <p>{package_.description}</p>
              </div>
              <ul>
                {package_.items.map((item) => (
                  <li key={`${item.name}-${item.quantity}`}>
                    <span>{item.name}</span>
                    <strong>× {item.quantity}</strong>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      {order.status === 'CLAIMABLE' ? (
        <form
          className="claim-flow stack-lg"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            submit.mutate();
          }}
        >
          {claimNotStarted ? (
            <InlineNotice tone="warning">
              领取将在 {formatDate(order.release.claimStartAt, true)} 开始。
            </InlineNotice>
          ) : null}
          <section className="panel claim-step">
            <div className="step-number">1</div>
            <div className="step-content">
              <div className="section-heading compact">
                <div>
                  <h2>选择收货地址</h2>
                  <p>提交后会冻结这份地址副本，之后修改地址簿不会影响本单。</p>
                </div>
                {!addingAddress ? (
                  <button
                    className="text-button"
                    onClick={() => setAddingAddress(true)}
                    type="button"
                  >
                    + 添加新地址
                  </button>
                ) : null}
              </div>
              {addresses.isPending ? <LoadingState label="正在读取地址…" /> : null}
              <div className="address-choice-list">
                {addresses.data?.map((address) => (
                  <label
                    className={
                      address.id === addressId ? 'address-choice selected' : 'address-choice'
                    }
                    key={address.id}
                  >
                    <input
                      checked={address.id === addressId}
                      name="address"
                      onChange={() => setAddressId(address.id)}
                      type="radio"
                    />
                    <span>
                      <strong>
                        {address.label}
                        {address.isDefault ? <small>默认</small> : null}
                      </strong>
                      <span>
                        {address.payload.recipientName} · {address.payload.phone}
                      </span>
                      <small>
                        {address.payload.province}
                        {address.payload.city}
                        {address.payload.district}
                        {address.payload.detailedAddress}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
              {addingAddress ? (
                <div className="inline-address-form">
                  <h3>添加新地址</h3>
                  <AddressForm
                    compact
                    onCancel={() => setAddingAddress(false)}
                    onSaved={(address: AddressRecord) => {
                      setAddressId(address.id);
                      setAddingAddress(false);
                    }}
                  />
                </div>
              ) : null}
            </div>
          </section>

          {order.release.formFields.length > 0 ? (
            <section className="panel claim-step">
              <div className="step-number">2</div>
              <div className="step-content">
                <div className="section-heading compact">
                  <div>
                    <h2>礼物选项</h2>
                    <p>请按主播提供的选项完成填写。</p>
                  </div>
                </div>
                <div className="claim-fields">
                  {order.release.formFields.map((field) => (
                    <label
                      className={field.type === 'CHECKBOX' ? 'check-field' : undefined}
                      key={field.key}
                    >
                      {field.type === 'CHECKBOX' ? (
                        <>
                          <input
                            checked={options[field.key] === true}
                            onChange={(event) =>
                              setOptions((current) => ({
                                ...current,
                                [field.key]: event.target.checked,
                              }))
                            }
                            required={field.required}
                            type="checkbox"
                          />
                          {field.label}
                        </>
                      ) : (
                        <>
                          {field.label}
                          {field.required ? <span className="required">*</span> : null}
                          {field.type === 'TEXTAREA' ? (
                            <textarea
                              onChange={(event) =>
                                setOptions((current) => ({
                                  ...current,
                                  [field.key]: event.target.value,
                                }))
                              }
                              required={field.required}
                              rows={4}
                              value={(options[field.key] as string | undefined) ?? ''}
                            />
                          ) : field.type === 'SELECT' || field.type === 'RADIO' ? (
                            <select
                              onChange={(event) =>
                                setOptions((current) => ({
                                  ...current,
                                  [field.key]: event.target.value,
                                }))
                              }
                              required={field.required}
                              value={(options[field.key] as string | undefined) ?? ''}
                            >
                              <option value="">请选择</option>
                              {field.options?.map((option) => (
                                <option key={option}>{option}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              onChange={(event) =>
                                setOptions((current) => ({
                                  ...current,
                                  [field.key]: event.target.value,
                                }))
                              }
                              required={field.required}
                              value={(options[field.key] as string | undefined) ?? ''}
                            />
                          )}
                        </>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          <section className="panel claim-step confirmation-step">
            <div className="step-number">{order.release.formFields.length > 0 ? '3' : '2'}</div>
            <div className="step-content">
              <h2>确认领取</h2>
              {selectedAddress ? (
                <div className="confirmation-summary">
                  <span>将寄送给</span>
                  <strong>{selectedAddress.payload.recipientName}</strong>
                  <p>
                    {selectedAddress.payload.province}
                    {selectedAddress.payload.city}
                    {selectedAddress.payload.district}
                    {selectedAddress.payload.detailedAddress}
                  </p>
                </div>
              ) : null}
              <label className="check-field confirm-check">
                <input
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  required
                  type="checkbox"
                />
                我已核对礼物、收货地址和填写内容；提交后将不能自行修改。
              </label>
              {submit.isError ? (
                <InlineNotice tone="danger">{submit.error.message}</InlineNotice>
              ) : null}
              <button
                className="button primary large"
                disabled={!addressId || !confirmed || submit.isPending || claimNotStarted}
                type="submit"
              >
                {submit.isPending ? '正在提交…' : '确认领取礼物'}
              </button>
            </div>
          </section>
        </form>
      ) : (
        <OrderProgress order={order} />
      )}
    </div>
  );
}

function OrderProgress({ order }: { readonly order: Awaited<ReturnType<typeof getMyGift>> }) {
  const shipment = order.shipments[0];
  return (
    <section className="panel order-progress">
      <div className="section-heading compact">
        <div>
          <p className="eyebrow">ORDER PROGRESS</p>
          <h2>礼物进度</h2>
        </div>
        <StatusBadge status={order.status}>{orderStatusLabel[order.status]}</StatusBadge>
      </div>
      <div className="progress-track">
        {[
          { done: order.submittedAt !== null, label: '已提交', time: order.submittedAt },
          { done: order.processingAt !== null, label: '处理中', time: order.processingAt },
          { done: order.shippedAt !== null, label: '已发货', time: order.shippedAt },
          { done: order.completedAt !== null, label: '已完成', time: order.completedAt },
        ].map((step) => (
          <div className={step.done ? 'progress-step done' : 'progress-step'} key={step.label}>
            <i>{step.done ? '✓' : ''}</i>
            <strong>{step.label}</strong>
            <small>{step.time ? formatDate(step.time, true) : '等待更新'}</small>
          </div>
        ))}
      </div>
      {shipment ? (
        <div className="tracking-card">
          <div>
            <p className="eyebrow">物流信息</p>
            <h3>{shipment.carrierName}</h3>
            <p>运单号 {shipment.trackingNumber}</p>
          </div>
          {shipment.trackingUrl ? (
            <a
              className="button secondary"
              href={shipment.trackingUrl}
              rel="noreferrer"
              target="_blank"
            >
              查询物流
            </a>
          ) : null}
          {shipment.events.length > 0 ? (
            <ol className="tracking-events">
              {shipment.events.map((event) => (
                <li key={`${event.occurredAt}-${event.description}`}>
                  <time>{formatDate(event.occurredAt, true)}</time>
                  <div>
                    <strong>{event.description}</strong>
                    {event.location ? <span>{event.location}</span> : null}
                  </div>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : (
        <p className="quiet-line">
          {order.status === 'EXPIRED'
            ? '这份礼物未在领取期限内提交。'
            : order.status === 'CANCELLED'
              ? '这份礼物单已取消。'
              : '主播处理后，物流信息会显示在这里。'}
        </p>
      )}
    </section>
  );
}
