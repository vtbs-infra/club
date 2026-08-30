import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, ExternalLink, Gift, PackageCheck, Plus } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';

import { getAddresses, getMyGift, submitGift, type AddressRecord } from '../api/client';
import { AddressForm } from '../components/AddressEditor';
import { ErrorNotice, ErrorState, InlineNotice, LoadingState, StatusBadge } from '../components/Ui';
import { useNow } from '../hooks/useNow';
import { formatDate, formatMonth, tierLabel } from '../lib/format';
import {
  giftOrderPresentation,
  shipmentExceptionPresentation,
  shipmentProgressPresentation,
} from '../lib/status-presentation';

export function GiftDetailPage() {
  const now = useNow();
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
  const [addressChoiceId, setAddressChoiceId] = useState('');
  const [addingAddress, setAddingAddress] = useState(false);
  const [options, setOptions] = useState<Record<string, boolean | string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const addressFormRef = useRef<HTMLDivElement>(null);
  const startAddingAddress = () => {
    setAddingAddress(true);
    window.requestAnimationFrame(() =>
      addressFormRef.current?.scrollIntoView({ block: 'nearest' }),
    );
  };
  const selectedAddressId =
    addresses.data?.find((address) => address.id === addressChoiceId)?.id ??
    addresses.data?.find((address) => address.isDefault)?.id ??
    addresses.data?.[0]?.id ??
    '';
  const submit = useMutation({
    mutationFn: () =>
      submitGift(giftOrderId, {
        addressId: selectedAddressId,
        expectedVersion: gift.data!.version,
        options,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['gifts'] }),
        queryClient.invalidateQueries({ queryKey: ['me', 'announcements'] }),
      ]);
      window.scrollTo({ top: 0 });
    },
  });

  if (gift.isPending) return <LoadingState label="正在读取礼物详情…" />;
  if (gift.isError || !gift.data) return <ErrorState error={gift.error} />;
  const order = gift.data;
  const selectedAddress = addresses.data?.find((address) => address.id === selectedAddressId);
  const claimNotStarted = new Date(order.release.claimStartAt).getTime() > now;
  const claimEnded = new Date(order.release.claimDeadlineAt).getTime() < now;

  return (
    <div className="gift-detail stack-lg">
      <Link className="back-link" to="/gifts">
        <ArrowLeft aria-hidden="true" size={16} />
        返回礼物单
      </Link>
      <section className="gift-detail-hero">
        <div className="detail-art">
          {order.release.coverImageUrl ? (
            <img alt="" src={order.release.coverImageUrl} />
          ) : (
            <div className="gift-placeholder">
              <span>
                <Gift size={58} strokeWidth={1.5} />
              </span>
              <small>舰长礼物</small>
            </div>
          )}
        </div>
        <div className="detail-copy">
          <div className="detail-status-row">
            <StatusBadge {...giftOrderPresentation[order.status]} />
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
            <p className="eyebrow">礼物清单</p>
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
          {claimEnded ? (
            <InlineNotice tone="danger">
              领取已于 {formatDate(order.release.claimDeadlineAt, true)} 结束，不能再提交。
            </InlineNotice>
          ) : claimNotStarted ? (
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
                  <button className="text-button" onClick={startAddingAddress} type="button">
                    <Plus aria-hidden="true" size={15} />
                    添加新地址
                  </button>
                ) : null}
              </div>
              {addresses.isPending ? <LoadingState label="正在读取地址…" /> : null}
              {addresses.isError ? (
                <ErrorState error={addresses.error} title="暂时无法读取收货地址" />
              ) : null}
              <div className="address-choice-list">
                {addresses.data?.map((address) => (
                  <label
                    className={
                      address.id === selectedAddressId
                        ? 'address-choice selected'
                        : 'address-choice'
                    }
                    key={address.id}
                  >
                    <input
                      checked={address.id === selectedAddressId}
                      name="address"
                      onChange={() => setAddressChoiceId(address.id)}
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
                <div className="inline-address-form" ref={addressFormRef}>
                  <h3>添加新地址</h3>
                  <AddressForm
                    autoFocus
                    compact
                    defaultSelected={addresses.data?.length === 0}
                    onCancel={() => setAddingAddress(false)}
                    onSaved={(address: AddressRecord) => {
                      setAddressChoiceId(address.id);
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
                  {order.release.formFields.map((field) =>
                    field.type === 'RADIO' ? (
                      <fieldset className="radio-field" key={field.key}>
                        <legend>
                          {field.label}
                          {field.required ? <span className="required">*</span> : null}
                        </legend>
                        <span className="radio-option-list">
                          {field.options?.map((option) => (
                            <label className="radio-option" key={option}>
                              <input
                                checked={options[field.key] === option}
                                name={`gift-option-${field.key}`}
                                onChange={() =>
                                  setOptions((current) => ({
                                    ...current,
                                    [field.key]: option,
                                  }))
                                }
                                required={field.required}
                                type="radio"
                              />
                              {option}
                            </label>
                          ))}
                        </span>
                      </fieldset>
                    ) : (
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
                            ) : field.type === 'SELECT' ? (
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
                    ),
                  )}
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
              {submit.isError ? <ErrorNotice error={submit.error} /> : null}
              <button
                className="button primary large"
                disabled={
                  !selectedAddressId ||
                  !confirmed ||
                  submit.isPending ||
                  claimNotStarted ||
                  claimEnded
                }
                type="submit"
              >
                {submit.isPending ? '正在提交…' : '确认领取礼物'}
                {!submit.isPending ? <PackageCheck aria-hidden="true" size={17} /> : null}
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
          <p className="eyebrow">履约进度</p>
          <h2>礼物进度</h2>
        </div>
        <StatusBadge {...giftOrderPresentation[order.status]} />
      </div>
      <div className="progress-track">
        {[
          { done: order.submittedAt !== null, label: '已领取', time: order.submittedAt },
          { done: order.shippedAt !== null, label: '已发货', time: order.shippedAt },
          { done: order.completedAt !== null, label: '已完成', time: order.completedAt },
        ].map((step) => (
          <div className={step.done ? 'progress-step done' : 'progress-step'} key={step.label}>
            <i>{step.done ? <Check aria-hidden="true" size={14} /> : null}</i>
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
            <span className="status-cluster">
              <StatusBadge {...shipmentProgressPresentation(shipment.progress)} />
              {shipment.exceptionMessage ? (
                <StatusBadge {...shipmentExceptionPresentation} />
              ) : null}
            </span>
          </div>
          {shipment.trackingUrl ? (
            <a
              className="button secondary"
              href={shipment.trackingUrl}
              rel="noreferrer"
              target="_blank"
            >
              查询物流
              <ExternalLink aria-hidden="true" size={15} />
            </a>
          ) : null}
          {shipment.exceptionMessage ? (
            <InlineNotice tone="danger">
              <p>{shipment.exceptionMessage}</p>
            </InlineNotice>
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
              : '主播发货后，物流信息会显示在这里。'}
        </p>
      )}
    </section>
  );
}
