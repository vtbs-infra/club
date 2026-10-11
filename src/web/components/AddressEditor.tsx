import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';

import {
  createAddress,
  deleteAddress,
  getAddresses,
  updateAddress,
  type AddressPayload,
  type AddressRecord,
} from '../api/client';
import { ConfirmDialog, ErrorNotice, ErrorState, InlineNotice, LoadingState } from './Ui';
import { AddressRecognition } from './AddressRecognition';
import { RegionSelect } from './RegionSelect';

const emptyAddress: AddressPayload = {
  city: '',
  countryRegion: '中国大陆',
  detailedAddress: '',
  district: '',
  phone: '',
  postalCode: '',
  province: '',
  recipientName: '',
  userNote: '',
};

const fields: readonly {
  readonly key: keyof AddressPayload;
  readonly label: string;
  readonly maxLength: number;
  readonly placeholder?: string;
  readonly required?: boolean;
  readonly wide?: boolean;
}[] = [
  { key: 'recipientName', label: '收件人', maxLength: 100, required: true },
  { key: 'phone', label: '手机号码', maxLength: 40, required: true },
  { key: 'countryRegion', label: '国家或地区', maxLength: 100, required: true },
  { key: 'province', label: '省 / 直辖市', maxLength: 100, required: true },
  { key: 'city', label: '城市', maxLength: 100, required: true },
  { key: 'district', label: '区 / 县', maxLength: 100 },
  {
    key: 'detailedAddress',
    label: '详细地址',
    maxLength: 500,
    placeholder: '街道、门牌号、楼栋及房间号',
    required: true,
    wide: true,
  },
  { key: 'postalCode', label: '邮政编码', maxLength: 20 },
  {
    key: 'userNote',
    label: '配送备注',
    maxLength: 500,
    placeholder: '选填，仅在发货需要时使用',
    wide: true,
  },
];

export function AddressForm({
  autoFocus = false,
  compact = false,
  defaultSelected = false,
  initial,
  onCancel,
  onSaved,
}: {
  readonly autoFocus?: boolean;
  readonly compact?: boolean;
  readonly defaultSelected?: boolean;
  readonly initial?: AddressRecord | undefined;
  readonly onCancel?: (() => void) | undefined;
  readonly onSaved?: ((address: AddressRecord) => void) | undefined;
}) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState(initial?.label ?? '常用地址');
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? defaultSelected);
  const [payload, setPayload] = useState<AddressPayload>(initial?.payload ?? emptyAddress);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [manualRegions, setManualRegions] = useState(false);
  const [recognitionNotice, setRecognitionNotice] = useState('');
  const [replacement, setReplacement] = useState<AddressPayload | null>(null);
  const tools = useQuery({
    queryKey: ['address-tools'],
    queryFn: () => import('../lib/address-parser'),
    staleTime: Infinity,
    retry: 1,
  });
  const useRegionSelect =
    payload.countryRegion.trim() === '中国大陆' && tools.data && !manualRegions;
  const selectedProvince = tools.data?.addressRegions.find(
    (region) => region.name === payload.province,
  );
  const selectedCity = selectedProvince?.children.find((region) => region.name === payload.city);
  const applyRecognition = (value: AddressPayload) => {
    setPayload((current) => ({ ...value, userNote: current.userNote || value.userNote }));
    setManualRegions(false);
    setValidationError(null);
    const missing = fields
      .filter((field) => field.required && !value[field.key].trim())
      .map((field) => field.label);
    setRecognitionNotice(
      missing.length
        ? `已填入识别结果，请补充${missing.join('、')}，并核对后保存。`
        : '已填入识别结果，请核对姓名、电话和门牌号后保存。',
    );
    setReplacement(null);
  };
  const save = useMutation({
    mutationFn: () =>
      initial
        ? updateAddress(initial.id, { isDefault, label, payload })
        : createAddress({ isDefault, label, payload }),
    onSuccess: async (address) => {
      await queryClient.invalidateQueries({ queryKey: ['me', 'addresses'] });
      onSaved?.(address);
    },
  });

  return (
    <form
      className={compact ? 'address-editor compact' : 'address-editor'}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        event.stopPropagation();
        if (save.isPending || replacement) return;
        if (!label.trim()) {
          setValidationError('地址名称不能只包含空格。');
          return;
        }
        const missingField = fields.find((field) => field.required && !payload[field.key].trim());
        if (missingField) {
          setValidationError(`请填写${missingField.label}。`);
          return;
        }
        const oversizedField = fields.find((field) => payload[field.key].length > field.maxLength);
        if (oversizedField) {
          setValidationError(
            `${oversizedField.label}不能超过 ${oversizedField.maxLength} 个字符，请修改后保存。`,
          );
          return;
        }
        if (!/^[+0-9 ()-]{5,40}$/.test(payload.phone.trim())) {
          setValidationError('手机号码只能包含数字、空格、括号、加号或连字符。');
          return;
        }
        setValidationError(null);
        save.mutate();
      }}
    >
      <fieldset className="address-form-fields" disabled={save.isPending}>
        {payload.countryRegion.trim() === '中国大陆' && tools.data ? (
          <AddressRecognition
            autoFocus={autoFocus && !initial}
            recognize={tools.data.recognizeAddress}
            onApply={(value) => {
              const hasInput = fields.some(
                ({ key }) => key !== 'countryRegion' && key !== 'userNote' && payload[key].trim(),
              );
              if (hasInput) setReplacement(value);
              else applyRecognition(value);
            }}
          />
        ) : null}
        {tools.isPending ? (
          <p className="quiet-line" role="status">
            正在加载地址识别与地区列表，可先手动填写。
          </p>
        ) : null}
        {tools.isError ? (
          <div className="address-recognition-actions">
            <p className="quiet-line">地址识别与地区列表暂时不可用，请手动填写。</p>
            <button className="text-button" type="button" onClick={() => void tools.refetch()}>
              重新加载
            </button>
          </div>
        ) : null}
        {recognitionNotice ? (
          <p className="recognition-notice" role="status">
            {recognitionNotice}
          </p>
        ) : null}
        <div className="form-grid">
          <label>
            地址名称
            <input
              autoFocus={autoFocus && Boolean(initial)}
              maxLength={80}
              onChange={(event) => {
                setValidationError(null);
                setLabel(event.target.value);
              }}
              required
              value={label}
            />
          </label>
          <label className="check-field">
            <input
              checked={isDefault}
              onChange={(event) => {
                setValidationError(null);
                setIsDefault(event.target.checked);
              }}
              type="checkbox"
            />
            设为默认地址
          </label>
          {fields
            .filter(
              (field) =>
                ![
                  'province',
                  'city',
                  'district',
                  'detailedAddress',
                  'postalCode',
                  'userNote',
                ].includes(field.key),
            )
            .map((field) => (
              <label className={field.wide ? 'span-full' : undefined} key={field.key}>
                {field.label}
                <input
                  inputMode={field.key === 'phone' ? 'tel' : undefined}
                  maxLength={field.maxLength}
                  onChange={(event) => {
                    setValidationError(null);
                    setPayload((current) => ({
                      ...current,
                      [field.key]: event.target.value,
                    }));
                  }}
                  pattern={field.key === 'phone' ? '[+0-9 ()-]{5,40}' : undefined}
                  placeholder={field.placeholder}
                  required={field.required}
                  value={payload[field.key]}
                />
              </label>
            ))}
          <div className="span-full stack-md">
            <div className="address-recognition-actions">
              <strong>所在地区</strong>
              {payload.countryRegion.trim() === '中国大陆' && tools.data ? (
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setManualRegions(!manualRegions)}
                >
                  {manualRegions ? '使用地区选择' : '手动填写地区'}
                </button>
              ) : null}
            </div>
            {useRegionSelect ? (
              <div className="address-region-grid">
                <RegionSelect
                  label="省 / 直辖市"
                  options={tools.data.addressRegions}
                  value={payload.province}
                  required
                  onChange={(province) => {
                    setValidationError(null);
                    setPayload((current) => ({
                      ...current,
                      province: province.name,
                      city: province.children.length === 1 ? province.children[0]!.name : '',
                      district: '',
                    }));
                  }}
                />
                <RegionSelect
                  label="城市"
                  options={selectedProvince?.children ?? []}
                  value={payload.city}
                  required
                  disabled={!selectedProvince}
                  onChange={(city) => {
                    setValidationError(null);
                    setPayload((current) => ({ ...current, city: city.name, district: '' }));
                  }}
                />
                <RegionSelect
                  label="区 / 县"
                  options={selectedCity?.children ?? []}
                  value={payload.district}
                  disabled={!selectedCity?.children.length}
                  onChange={(district) => {
                    setValidationError(null);
                    setPayload((current) => ({ ...current, district: district.name }));
                  }}
                />
              </div>
            ) : (
              <div className="address-region-grid">
                {fields
                  .filter((field) => ['province', 'city', 'district'].includes(field.key))
                  .map((field) => (
                    <label key={field.key}>
                      {field.label}
                      <input
                        maxLength={field.maxLength}
                        required={field.required}
                        value={payload[field.key]}
                        onChange={(event) => {
                          setValidationError(null);
                          setPayload((current) => ({
                            ...current,
                            [field.key]: event.target.value,
                          }));
                        }}
                      />
                    </label>
                  ))}
              </div>
            )}
            {useRegionSelect && !tools.data.isKnownRegion(payload) ? (
              <p className="quiet-line">
                当前地区不在列表中，已保留原内容。可重新选择，或切换为手动填写。
              </p>
            ) : (
              <p className="quiet-line">
                找不到新地区或历史地名时，可以手动填写；不设区县的城市可留空。
              </p>
            )}
          </div>
          {fields
            .filter((field) => ['detailedAddress', 'postalCode', 'userNote'].includes(field.key))
            .map((field) => (
              <label className={field.wide ? 'span-full' : undefined} key={field.key}>
                {field.label}
                <input
                  maxLength={field.maxLength}
                  placeholder={field.placeholder}
                  required={field.required}
                  value={payload[field.key]}
                  onChange={(event) => {
                    setValidationError(null);
                    setPayload((current) => ({ ...current, [field.key]: event.target.value }));
                  }}
                />
              </label>
            ))}
        </div>
        {validationError ? (
          <InlineNotice tone="danger">
            <p>{validationError}</p>
          </InlineNotice>
        ) : null}
        {save.isError ? <ErrorNotice error={save.error} /> : null}
        <div className="form-actions">
          <button className="button primary" disabled={save.isPending} type="submit">
            {save.isPending ? '正在保存…' : initial ? '保存修改' : '保存并使用'}
          </button>
          {onCancel ? (
            <button className="button ghost" onClick={onCancel} type="button">
              取消
            </button>
          ) : null}
        </div>
      </fieldset>
      <ConfirmDialog
        open={replacement !== null}
        title="替换当前收件信息？"
        description="识别结果将替换收件人、电话、地区、详细地址和邮编。地址名称、默认地址设置与已填写的配送备注会保留。替换后仍可修改，点击保存后才会存入地址簿。"
        confirmLabel="替换并核对"
        onCancel={() => setReplacement(null)}
        onConfirm={() => {
          if (replacement) applyRecognition(replacement);
        }}
      />
    </form>
  );
}

export function AddressBook() {
  const queryClient = useQueryClient();
  const addresses = useQuery({ queryFn: getAddresses, queryKey: ['me', 'addresses'] });
  const [editing, setEditing] = useState<AddressRecord | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AddressRecord | null>(null);
  const editorRef = useRef<HTMLElement>(null);
  const revealEditor = () => {
    window.requestAnimationFrame(() => editorRef.current?.scrollIntoView({ block: 'nearest' }));
  };
  const startAdding = () => {
    setEditing(null);
    setAdding(true);
    revealEditor();
  };
  const startEditing = (address: AddressRecord) => {
    setAdding(false);
    setEditing(address);
    revealEditor();
  };
  const remove = useMutation({
    mutationFn: deleteAddress,
    onSuccess: () => {
      setDeleteTarget(null);
      return queryClient.invalidateQueries({ queryKey: ['me', 'addresses'] });
    },
  });
  if (addresses.isPending) return <LoadingState label="正在读取地址…" />;
  if (addresses.isError) return <ErrorState error={addresses.error} />;
  return (
    <div className="stack-lg">
      <div className="section-heading">
        <div>
          <h2>收货地址</h2>
          <p>地址会加密保存；礼物提交后会冻结当时的地址副本。</p>
        </div>
        {!adding && !editing ? (
          <button className="button primary" onClick={startAdding} type="button">
            添加地址
          </button>
        ) : null}
      </div>
      {addresses.data.length === 0 && !adding ? (
        <div className="empty-inline">
          <p>还没有收货地址。</p>
          <button className="button secondary" onClick={startAdding} type="button">
            添加第一个地址
          </button>
        </div>
      ) : (
        <div className="address-grid">
          {addresses.data.map((address) => (
            <article className="address-card" key={address.id}>
              <div className="address-card-top">
                <strong>{address.label}</strong>
                {address.isDefault ? <span className="soft-tag">默认</span> : null}
              </div>
              <p>
                {address.payload.recipientName}
                <span>{address.payload.phone}</span>
              </p>
              <small>
                {address.payload.province}
                {address.payload.city}
                {address.payload.district}
                {address.payload.detailedAddress}
              </small>
              {!adding && !editing ? (
                <div className="card-actions">
                  <button
                    className="text-button"
                    onClick={() => startEditing(address)}
                    type="button"
                  >
                    编辑
                  </button>
                  <button
                    className="text-button danger"
                    disabled={remove.isPending}
                    onClick={() => setDeleteTarget(address)}
                    type="button"
                  >
                    删除
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
      {adding ? (
        <section className="panel" ref={editorRef}>
          <h3>添加收货地址</h3>
          <AddressForm
            autoFocus
            defaultSelected={addresses.data.length === 0}
            onCancel={() => setAdding(false)}
            onSaved={() => setAdding(false)}
          />
        </section>
      ) : null}
      {editing ? (
        <section className="panel" ref={editorRef}>
          <h3>编辑“{editing.label}”</h3>
          <AddressForm
            autoFocus
            initial={editing}
            key={editing.id}
            onCancel={() => setEditing(null)}
            onSaved={() => setEditing(null)}
          />
        </section>
      ) : null}
      {remove.isError ? <ErrorNotice error={remove.error} /> : null}
      <ConfirmDialog
        busy={remove.isPending}
        confirmLabel="删除地址"
        description={
          <>地址簿中的“{deleteTarget?.label}”会被删除。已经提交的礼物单仍保留各自冻结的地址副本。</>
        }
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget.id);
        }}
        open={deleteTarget !== null}
        title="确认删除收货地址？"
        tone="danger"
      />
    </div>
  );
}
