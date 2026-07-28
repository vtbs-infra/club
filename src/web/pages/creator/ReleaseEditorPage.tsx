import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import {
  closeCreatorRelease,
  createCreatorRelease,
  deleteCreatorRelease,
  getCreatorRelease,
  publishCreatorRelease,
  updateCreatorRelease,
  uploadCreatorReleaseCover,
  type GiftFormField,
  type GuardTier,
  type ReleaseInput,
} from '../../api/client';
import { ErrorState, InlineNotice, LoadingState, StatusBadge } from '../../components/Ui';
import { formatMonth } from '../../lib/format';

interface EditableItem {
  description: string;
  name: string;
  quantity: number;
}

interface EditablePackage {
  description: string;
  items: EditableItem[];
  name: string;
}

interface EditableField {
  key: string;
  label: string;
  options: string[];
  required: boolean;
  type: GiftFormField['type'];
}

const tierNames: Readonly<Record<GuardTier, string>> = {
  ADMIRAL: '提督',
  CAPTAIN: '舰长',
  GOVERNOR: '总督',
};

function monthStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function localInput(iso: string): string {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function toIso(value: string): string {
  return new Date(value).toISOString();
}

const editorLoadedAt = new Date();
const defaultClaimStart = localInput(editorLoadedAt.toISOString());
const defaultClaimDeadline = localInput(
  new Date(editorLoadedAt.getTime() + 30 * 86_400_000).toISOString(),
);

export function ReleaseEditorPage() {
  const { releaseId = 'new' } = useParams();
  const isNew = releaseId === 'new';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const release = useQuery({
    enabled: !isNew,
    queryFn: () => getCreatorRelease(releaseId),
    queryKey: ['creator', 'releases', releaseId],
  });
  const initialized = useRef<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [eligibilityMonth, setEligibilityMonth] = useState(monthStart());
  const [claimStartAt, setClaimStartAt] = useState(defaultClaimStart);
  const [claimDeadlineAt, setClaimDeadlineAt] = useState(defaultClaimDeadline);
  const [fulfillmentMode, setFulfillmentMode] =
    useState<ReleaseInput['fulfillmentMode']>('HIGHEST_ONLY');
  const [packages, setPackages] = useState<EditablePackage[]>([
    {
      description: '',
      items: [{ description: '', name: '纪念礼物', quantity: 1 }],
      name: '舰长礼物',
    },
  ]);
  const [tierPackageIndexes, setTierPackageIndexes] = useState<Record<GuardTier, number>>({
    ADMIRAL: 0,
    CAPTAIN: 0,
    GOVERNOR: 0,
  });
  const [fields, setFields] = useState<EditableField[]>([]);
  const [coverFile, setCoverFile] = useState<File | null>(null);

  useEffect(() => {
    if (!release.data || initialized.current === release.data.id) return;
    initialized.current = release.data.id;
    setTitle(release.data.title);
    setDescription(release.data.description);
    setEligibilityMonth(release.data.eligibilityMonth);
    setClaimStartAt(localInput(release.data.claimStartAt));
    setClaimDeadlineAt(localInput(release.data.claimDeadlineAt));
    setFulfillmentMode(release.data.fulfillmentMode);
    setPackages(
      release.data.packages?.map((package_) => ({
        description: package_.description,
        items: package_.items.map((item) => ({ ...item })),
        name: package_.name,
      })) ?? [],
    );
    setTierPackageIndexes({
      ADMIRAL: release.data.tierPackageIndexes?.ADMIRAL ?? 0,
      CAPTAIN: release.data.tierPackageIndexes?.CAPTAIN ?? 0,
      GOVERNOR: release.data.tierPackageIndexes?.GOVERNOR ?? 0,
    });
    setFields(
      release.data.formFields?.map((field) => ({
        ...field,
        options: [...(field.options ?? [])],
      })) ?? [],
    );
  }, [release.data]);

  const input = (): ReleaseInput => ({
    claimDeadlineAt: toIso(claimDeadlineAt),
    claimStartAt: toIso(claimStartAt),
    description,
    eligibilityMonth,
    formFields: fields.map((field) => ({
      key: field.key,
      label: field.label,
      ...(field.type === 'SELECT' || field.type === 'RADIO'
        ? { options: field.options.filter(Boolean) }
        : {}),
      required: field.required,
      type: field.type,
    })),
    fulfillmentMode,
    packages,
    tierPackageIndexes,
    title,
  });

  const save = useMutation({
    mutationFn: () =>
      isNew ? createCreatorRelease(input()) : updateCreatorRelease(releaseId, input()),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['creator', 'releases'] });
      if (isNew) await navigate(`/creator/releases/${saved.id}`, { replace: true });
      else queryClient.setQueryData(['creator', 'releases', releaseId], saved);
    },
  });
  const upload = useMutation({
    mutationFn: async () => {
      if (!coverFile || isNew) throw new Error('请先保存草稿，再上传图片。');
      return uploadCreatorReleaseCover(releaseId, coverFile);
    },
    onSuccess: async () => {
      setCoverFile(null);
      await queryClient.invalidateQueries({ queryKey: ['creator', 'releases'] });
    },
  });
  const publish = useMutation({
    mutationFn: () => publishCreatorRelease(releaseId),
    onSuccess: async (published) => {
      queryClient.setQueryData(['creator', 'releases', releaseId], published);
      await queryClient.invalidateQueries({ queryKey: ['creator', 'releases'] });
    },
  });
  const close = useMutation({
    mutationFn: () => closeCreatorRelease(releaseId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['creator', 'releases'] }),
  });
  const remove = useMutation({
    mutationFn: () => deleteCreatorRelease(releaseId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['creator', 'releases'] });
      await navigate('/creator/releases', { replace: true });
    },
  });

  if (!isNew && release.isPending) return <LoadingState label="正在读取礼物发布…" />;
  if (!isNew && (release.isError || !release.data)) return <ErrorState error={release.error} />;
  const status = release.data?.status ?? 'DRAFT';
  const editable = status === 'DRAFT';

  const updatePackage = (index: number, patch: Partial<EditablePackage>) => {
    setPackages((current) =>
      current.map((package_, candidate) =>
        candidate === index ? { ...package_, ...patch } : package_,
      ),
    );
  };

  return (
    <div className="stack-lg release-editor-page">
      <Link className="back-link" to="/creator/releases">
        ← 返回礼物发布
      </Link>
      <header className="editor-header">
        <div>
          <div className="detail-status-row">
            <StatusBadge status={status}>
              {status === 'DRAFT' ? '草稿' : status === 'PUBLISHED' ? '已发布' : '已关闭'}
            </StatusBadge>
            <span>{formatMonth(eligibilityMonth)}资格</span>
          </div>
          <h1>{isNew ? '创建礼物发布' : title}</h1>
          <p>选择资格月份并配置不同大航海等级获得的礼物。</p>
        </div>
        <div className="page-actions">
          {editable ? (
            <>
              <button
                className="button secondary"
                disabled={save.isPending}
                form="release-form"
                type="submit"
              >
                {save.isPending ? '正在保存…' : '保存草稿'}
              </button>
              {!isNew ? (
                <button
                  className="button primary"
                  disabled={publish.isPending}
                  onClick={() => {
                    if (window.confirm('发布后礼物配置将被冻结。确认发布吗？')) publish.mutate();
                  }}
                  type="button"
                >
                  发布并生成礼物单
                </button>
              ) : null}
            </>
          ) : status === 'PUBLISHED' ? (
            <button
              className="button ghost"
              disabled={close.isPending}
              onClick={() => {
                if (window.confirm('关闭后将停止展示为当前发布，已有礼物单不受影响。'))
                  close.mutate();
              }}
              type="button"
            >
              关闭发布
            </button>
          ) : null}
        </div>
      </header>

      {!editable ? (
        <InlineNotice tone="info">发布后的礼物内容和资格月份已经冻结，仅供查看。</InlineNotice>
      ) : null}
      {save.isError || publish.isError || close.isError ? (
        <InlineNotice tone="danger">
          {save.error?.message ?? publish.error?.message ?? close.error?.message}
        </InlineNotice>
      ) : null}

      <form
        className="release-form stack-lg"
        id="release-form"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <section className="panel editor-section">
          <div className="editor-section-title">
            <span>1</span>
            <div>
              <h2>基本信息</h2>
              <p>用户在礼物卡片和领取页看到的内容。</p>
            </div>
          </div>
          <div className="form-grid">
            <label className="span-full">
              礼物名称
              <input
                disabled={!editable}
                maxLength={160}
                onChange={(event) => setTitle(event.target.value)}
                required
                value={title}
              />
            </label>
            <label className="span-full">
              礼物说明
              <textarea
                disabled={!editable}
                maxLength={5_000}
                onChange={(event) => setDescription(event.target.value)}
                rows={5}
                value={description}
              />
            </label>
            <label>
              资格月份
              <input
                disabled={!editable}
                onChange={(event) => setEligibilityMonth(`${event.target.value}-01`)}
                required
                type="month"
                value={eligibilityMonth.slice(0, 7)}
              />
              <small>使用这个月冻结的大航海名单。</small>
            </label>
            <label>
              发放方式
              <select
                disabled={!editable}
                onChange={(event) =>
                  setFulfillmentMode(event.target.value as ReleaseInput['fulfillmentMode'])
                }
                value={fulfillmentMode}
              >
                <option value="HIGHEST_ONLY">仅发对应最高等级礼包</option>
                <option value="CUMULATIVE">逐级累计礼包</option>
              </select>
            </label>
            <label>
              开始领取
              <input
                disabled={!editable}
                onChange={(event) => setClaimStartAt(event.target.value)}
                required
                type="datetime-local"
                value={claimStartAt}
              />
            </label>
            <label>
              截止领取
              <input
                disabled={!editable}
                onChange={(event) => setClaimDeadlineAt(event.target.value)}
                required
                type="datetime-local"
                value={claimDeadlineAt}
              />
            </label>
          </div>
        </section>

        <section className="panel editor-section">
          <div className="editor-section-title">
            <span>2</span>
            <div>
              <h2>礼物图片</h2>
              <p>这张图片会显示在用户的礼物卡片与详情页。</p>
            </div>
          </div>
          <div className="cover-uploader">
            <div className="cover-preview">
              {release.data?.coverObjectKey ? (
                <img
                  alt="当前礼物封面"
                  src={`/api/v1/gift-releases/${releaseId}/cover?version=${release.data.updatedAt}`}
                />
              ) : coverFile ? (
                <img alt="待上传封面预览" src={URL.createObjectURL(coverFile)} />
              ) : (
                <div className="gift-placeholder">
                  <span>✦</span>
                  <small>礼物图片</small>
                </div>
              )}
            </div>
            <div>
              {editable ? (
                <>
                  <label className="file-button">
                    选择图片
                    <input
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(event) => setCoverFile(event.target.files?.[0] ?? null)}
                      type="file"
                    />
                  </label>
                  <p>JPEG、PNG 或 WebP，最大 5 MB。系统会统一转为 WebP。</p>
                  {isNew ? <small>先保存草稿，即可上传封面。</small> : null}
                  {coverFile && !isNew ? (
                    <button
                      className="button secondary"
                      disabled={upload.isPending}
                      onClick={() => upload.mutate()}
                      type="button"
                    >
                      {upload.isPending ? '正在上传…' : '上传封面'}
                    </button>
                  ) : null}
                </>
              ) : (
                <p>礼物发布后封面也会保持冻结。</p>
              )}
              {upload.isError ? (
                <InlineNotice tone="danger">{upload.error.message}</InlineNotice>
              ) : null}
            </div>
          </div>
        </section>

        <section className="panel editor-section">
          <div className="editor-section-title">
            <span>3</span>
            <div>
              <h2>礼物礼包</h2>
              <p>先创建礼包，再为舰长、提督和总督选择对应礼包。</p>
            </div>
            {editable ? (
              <button
                className="button ghost"
                onClick={() =>
                  setPackages((current) => [
                    ...current,
                    {
                      description: '',
                      items: [{ description: '', name: '', quantity: 1 }],
                      name: `礼包 ${current.length + 1}`,
                    },
                  ])
                }
                type="button"
              >
                + 添加礼包
              </button>
            ) : null}
          </div>
          <div className="package-editor-list">
            {packages.map((package_, packageIndex) => (
              <article className="package-editor" key={packageIndex}>
                <header>
                  <strong>礼包 {packageIndex + 1}</strong>
                  {editable && packages.length > 1 ? (
                    <button
                      className="text-button danger"
                      onClick={() => {
                        setPackages((current) =>
                          current.filter((_, index) => index !== packageIndex),
                        );
                        setTierPackageIndexes(
                          (current) =>
                            Object.fromEntries(
                              Object.entries(current).map(([tier, index]) => [
                                tier,
                                index === packageIndex
                                  ? 0
                                  : index > packageIndex
                                    ? index - 1
                                    : index,
                              ]),
                            ) as Record<GuardTier, number>,
                        );
                      }}
                      type="button"
                    >
                      删除
                    </button>
                  ) : null}
                </header>
                <div className="form-grid">
                  <label>
                    礼包名称
                    <input
                      disabled={!editable}
                      onChange={(event) =>
                        updatePackage(packageIndex, { name: event.target.value })
                      }
                      required
                      value={package_.name}
                    />
                  </label>
                  <label>
                    简短说明
                    <input
                      disabled={!editable}
                      onChange={(event) =>
                        updatePackage(packageIndex, { description: event.target.value })
                      }
                      value={package_.description}
                    />
                  </label>
                </div>
                <div className="item-editor-list">
                  {package_.items.map((item, itemIndex) => (
                    <div className="item-editor" key={itemIndex}>
                      <input
                        aria-label="物品名称"
                        disabled={!editable}
                        onChange={(event) =>
                          updatePackage(packageIndex, {
                            items: package_.items.map((candidate, index) =>
                              index === itemIndex
                                ? { ...candidate, name: event.target.value }
                                : candidate,
                            ),
                          })
                        }
                        placeholder="物品名称"
                        required
                        value={item.name}
                      />
                      <input
                        aria-label="数量"
                        disabled={!editable}
                        min={1}
                        onChange={(event) =>
                          updatePackage(packageIndex, {
                            items: package_.items.map((candidate, index) =>
                              index === itemIndex
                                ? { ...candidate, quantity: Number(event.target.value) }
                                : candidate,
                            ),
                          })
                        }
                        type="number"
                        value={item.quantity}
                      />
                      <input
                        aria-label="物品说明"
                        disabled={!editable}
                        onChange={(event) =>
                          updatePackage(packageIndex, {
                            items: package_.items.map((candidate, index) =>
                              index === itemIndex
                                ? { ...candidate, description: event.target.value }
                                : candidate,
                            ),
                          })
                        }
                        placeholder="说明（选填）"
                        value={item.description}
                      />
                      {editable && package_.items.length > 1 ? (
                        <button
                          aria-label="删除物品"
                          className="icon-button danger"
                          onClick={() =>
                            updatePackage(packageIndex, {
                              items: package_.items.filter((_, index) => index !== itemIndex),
                            })
                          }
                          type="button"
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {editable ? (
                    <button
                      className="text-button"
                      onClick={() =>
                        updatePackage(packageIndex, {
                          items: [...package_.items, { description: '', name: '', quantity: 1 }],
                        })
                      }
                      type="button"
                    >
                      + 添加物品
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
          <div className="tier-mapping">
            {(['CAPTAIN', 'ADMIRAL', 'GOVERNOR'] as const).map((tier) => (
              <label key={tier}>
                <strong>{tierNames[tier]}</strong>
                <span>获得</span>
                <select
                  disabled={!editable}
                  onChange={(event) =>
                    setTierPackageIndexes((current) => ({
                      ...current,
                      [tier]: Number(event.target.value),
                    }))
                  }
                  value={Math.min(tierPackageIndexes[tier], Math.max(0, packages.length - 1))}
                >
                  {packages.map((package_, index) => (
                    <option key={index} value={index}>
                      {package_.name || `礼包 ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </section>

        <section className="panel editor-section">
          <div className="editor-section-title">
            <span>4</span>
            <div>
              <h2>领取时需要填写的内容</h2>
              <p>收货地址无需重复配置；这里只添加尺码、款式等礼物专属选项。</p>
            </div>
            {editable ? (
              <button
                className="button ghost"
                onClick={() =>
                  setFields((current) => [
                    ...current,
                    {
                      key: `field_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`,
                      label: '',
                      options: [],
                      required: false,
                      type: 'TEXT',
                    },
                  ])
                }
                type="button"
              >
                + 添加填写项
              </button>
            ) : null}
          </div>
          {fields.length === 0 ? (
            <p className="quiet-line">无需额外填写内容，用户只需选择收货地址。</p>
          ) : (
            <div className="field-editor-list">
              {fields.map((field, index) => (
                <article className="field-editor" key={field.key}>
                  <label>
                    显示名称
                    <input
                      disabled={!editable}
                      onChange={(event) =>
                        setFields((current) =>
                          current.map((candidate, candidateIndex) =>
                            candidateIndex === index
                              ? { ...candidate, label: event.target.value }
                              : candidate,
                          ),
                        )
                      }
                      placeholder="例如：T恤尺码"
                      required
                      value={field.label}
                    />
                  </label>
                  <label>
                    填写方式
                    <select
                      disabled={!editable}
                      onChange={(event) =>
                        setFields((current) =>
                          current.map((candidate, candidateIndex) =>
                            candidateIndex === index
                              ? {
                                  ...candidate,
                                  options: [],
                                  type: event.target.value as GiftFormField['type'],
                                }
                              : candidate,
                          ),
                        )
                      }
                      value={field.type}
                    >
                      <option value="TEXT">单行文字</option>
                      <option value="TEXTAREA">多行文字</option>
                      <option value="SELECT">下拉选择</option>
                      <option value="RADIO">单项选择</option>
                      <option value="CHECKBOX">确认勾选</option>
                    </select>
                  </label>
                  <label className="check-field">
                    <input
                      checked={field.required}
                      disabled={!editable}
                      onChange={(event) =>
                        setFields((current) =>
                          current.map((candidate, candidateIndex) =>
                            candidateIndex === index
                              ? { ...candidate, required: event.target.checked }
                              : candidate,
                          ),
                        )
                      }
                      type="checkbox"
                    />
                    必填
                  </label>
                  {field.type === 'SELECT' || field.type === 'RADIO' ? (
                    <label className="span-full">
                      可选项（每行一个）
                      <textarea
                        disabled={!editable}
                        onChange={(event) =>
                          setFields((current) =>
                            current.map((candidate, candidateIndex) =>
                              candidateIndex === index
                                ? { ...candidate, options: event.target.value.split('\n') }
                                : candidate,
                            ),
                          )
                        }
                        rows={4}
                        value={field.options.join('\n')}
                      />
                    </label>
                  ) : null}
                  {editable ? (
                    <button
                      className="text-button danger"
                      onClick={() =>
                        setFields((current) =>
                          current.filter((_, candidateIndex) => candidateIndex !== index),
                        )
                      }
                      type="button"
                    >
                      删除填写项
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>

        {editable ? (
          <div className="editor-bottom-actions">
            <button className="button primary large" disabled={save.isPending} type="submit">
              {save.isPending ? '正在保存…' : isNew ? '创建草稿' : '保存草稿'}
            </button>
            {!isNew ? (
              <button
                className="button ghost danger"
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm('确认删除这份礼物草稿吗？')) remove.mutate();
                }}
                type="button"
              >
                删除草稿
              </button>
            ) : null}
          </div>
        ) : null}
      </form>
    </div>
  );
}
