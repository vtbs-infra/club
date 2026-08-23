import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, Send } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';

import {
  closeCreatorRelease,
  createCreatorRelease,
  deleteCreatorRelease,
  getCreatorRelease,
  getIdentity,
  publishCreatorRelease,
  updateCreatorRelease,
  uploadCreatorReleaseCover,
  type GuardTier,
  type ReleaseInput,
} from '../../api/client';
import { BasicInfoSection } from '../../components/release-editor/BasicInfoSection';
import { ClaimFieldsSection } from '../../components/release-editor/ClaimFieldsSection';
import { CoverSection } from '../../components/release-editor/CoverSection';
import { PackageEditorSection } from '../../components/release-editor/PackageEditorSection';
import { TierRulesSection } from '../../components/release-editor/TierRulesSection';
import type { EditableField, EditablePackage } from '../../components/release-editor/types';
import {
  ConfirmDialog,
  ErrorNotice,
  ErrorState,
  InlineNotice,
  LoadingState,
  StatusBadge,
} from '../../components/Ui';
import {
  dateTimeLocalToIso,
  epochMillisecondsToDateTimeLocal,
  isoToDateTimeLocal,
  PLATFORM_TIME_ZONE,
} from '../../lib/date-time';
import { formatMonth } from '../../lib/format';

function monthStart(timeZone: string): string {
  return `${epochMillisecondsToDateTimeLocal(Date.now(), timeZone).slice(0, 7)}-01`;
}

const editorLoadedAt = new Date();
const defaultClaimStart = epochMillisecondsToDateTimeLocal(
  editorLoadedAt.getTime(),
  PLATFORM_TIME_ZONE,
);
const defaultClaimDeadline = epochMillisecondsToDateTimeLocal(
  editorLoadedAt.getTime() + 30 * 86_400_000,
  PLATFORM_TIME_ZONE,
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
  const identity = useQuery({ queryFn: getIdentity, queryKey: ['identity'] });
  const formRef = useRef<HTMLFormElement>(null);
  const initialized = useRef<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [eligibilityMonth, setEligibilityMonth] = useState(monthStart(PLATFORM_TIME_ZONE));
  const [claimStartAt, setClaimStartAt] = useState(defaultClaimStart);
  const [claimDeadlineAt, setClaimDeadlineAt] = useState(defaultClaimDeadline);
  const [fulfillmentMode, setFulfillmentMode] =
    useState<ReleaseInput['fulfillmentMode']>('HIGHEST_ONLY');
  const [publicVisible, setPublicVisible] = useState(false);
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
  const [dirty, setDirty] = useState(false);
  const [confirmation, setConfirmation] = useState<'close' | 'delete' | 'publish' | null>(null);
  const status = release.data?.status ?? 'DRAFT';
  const editable = status === 'DRAFT';
  const hasUnsavedChanges = dirty || coverFile !== null;
  const blocker = useBlocker(hasUnsavedChanges && editable);
  const timeZone = identity.data?.creator?.timezone ?? PLATFORM_TIME_ZONE;

  useEffect(() => {
    if (!identity.data?.creator || !release.data || initialized.current === release.data.id) return;
    initialized.current = release.data.id;
    setTitle(release.data.title);
    setDescription(release.data.description);
    setEligibilityMonth(release.data.eligibilityMonth);
    setClaimStartAt(isoToDateTimeLocal(release.data.claimStartAt, timeZone));
    setClaimDeadlineAt(isoToDateTimeLocal(release.data.claimDeadlineAt, timeZone));
    setFulfillmentMode(release.data.fulfillmentMode);
    setPublicVisible(release.data.publicVisible);
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
    setCoverFile(null);
    setDirty(false);
  }, [identity.data?.creator, release.data, timeZone]);

  useEffect(() => {
    if (!isNew || !identity.data?.creator || dirty || initialized.current === `new:${timeZone}`)
      return;
    initialized.current = `new:${timeZone}`;
    const now = Date.now();
    setEligibilityMonth(monthStart(timeZone));
    setClaimStartAt(epochMillisecondsToDateTimeLocal(now, timeZone));
    setClaimDeadlineAt(epochMillisecondsToDateTimeLocal(now + 30 * 86_400_000, timeZone));
  }, [dirty, identity.data?.creator, isNew, timeZone]);

  useEffect(() => {
    if (!hasUnsavedChanges || !editable) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [editable, hasUnsavedChanges]);

  const coverPreviewUrl = useMemo(
    () => (coverFile ? URL.createObjectURL(coverFile) : null),
    [coverFile],
  );
  useEffect(
    () => () => {
      if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    },
    [coverPreviewUrl],
  );

  const input = (): ReleaseInput => ({
    claimDeadlineAt: dateTimeLocalToIso(claimDeadlineAt, timeZone),
    claimStartAt: dateTimeLocalToIso(claimStartAt, timeZone),
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
    publicVisible,
    tierPackageIndexes,
    title,
  });

  const save = useMutation({
    mutationFn: () =>
      isNew
        ? createCreatorRelease(input())
        : updateCreatorRelease(releaseId, {
            ...input(),
            expectedVersion: release.data!.version,
          }),
    onSuccess: async (saved) => {
      setDirty(false);
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
    mutationFn: () =>
      publishCreatorRelease(releaseId, {
        ...input(),
        expectedVersion: release.data!.version,
      }),
    onSuccess: async (published) => {
      setConfirmation(null);
      setDirty(false);
      queryClient.setQueryData(['creator', 'releases', releaseId], published);
      await queryClient.invalidateQueries({ queryKey: ['creator', 'releases'] });
    },
  });
  const close = useMutation({
    mutationFn: () => closeCreatorRelease(releaseId),
    onSuccess: () => {
      setConfirmation(null);
      return queryClient.invalidateQueries({ queryKey: ['creator', 'releases'] });
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteCreatorRelease(releaseId),
    onSuccess: async () => {
      setConfirmation(null);
      setDirty(false);
      await queryClient.invalidateQueries({ queryKey: ['creator', 'releases'] });
      await navigate('/creator/releases', { replace: true });
    },
  });

  if (identity.isPending || (!isNew && release.isPending))
    return <LoadingState label="正在读取礼物发布…" />;
  if (identity.isError || !identity.data?.creator)
    return <ErrorState error={identity.error} title="暂时无法读取主播资料" />;
  if (!isNew && (release.isError || !release.data)) return <ErrorState error={release.error} />;

  return (
    <div className="stack-lg release-editor-page">
      <Link className="back-link" to="/creator/releases">
        <ArrowLeft aria-hidden="true" size={16} />
        返回礼物发布
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
                disabled={save.isPending || publish.isPending || upload.isPending}
                form="release-form"
                type="submit"
              >
                {save.isPending ? '正在保存…' : '保存草稿'}
                {!save.isPending ? <Save aria-hidden="true" size={16} /> : null}
              </button>
              {!isNew ? (
                <button
                  className="button primary"
                  disabled={
                    publish.isPending || save.isPending || upload.isPending || coverFile !== null
                  }
                  onClick={() => {
                    if (formRef.current?.reportValidity()) setConfirmation('publish');
                  }}
                  type="button"
                >
                  发布并生成礼物单
                  <Send aria-hidden="true" size={16} />
                </button>
              ) : null}
            </>
          ) : status === 'PUBLISHED' ? (
            <button
              className="button ghost"
              disabled={close.isPending}
              onClick={() => setConfirmation('close')}
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
      {save.isError || publish.isError || close.isError || remove.isError ? (
        <ErrorNotice error={save.error ?? publish.error ?? close.error ?? remove.error} />
      ) : null}

      <form
        className="release-form stack-lg"
        id="release-form"
        onChange={() => setDirty(true)}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          save.mutate();
        }}
        ref={formRef}
      >
        <BasicInfoSection
          claimDeadlineAt={claimDeadlineAt}
          claimStartAt={claimStartAt}
          description={description}
          editable={editable}
          eligibilityMonth={eligibilityMonth}
          fulfillmentMode={fulfillmentMode}
          onClaimDeadlineAtChange={setClaimDeadlineAt}
          onClaimStartAtChange={setClaimStartAt}
          onDescriptionChange={setDescription}
          onEligibilityMonthChange={setEligibilityMonth}
          onFulfillmentModeChange={setFulfillmentMode}
          onPublicVisibleChange={setPublicVisible}
          onTitleChange={setTitle}
          publicVisible={publicVisible}
          timeZone={timeZone}
          title={title}
        />
        <CoverSection
          coverObjectKey={release.data?.coverObjectKey}
          coverPreviewUrl={coverPreviewUrl}
          editable={editable}
          isNew={isNew}
          onFileChange={setCoverFile}
          onUpload={() => upload.mutate()}
          releaseId={releaseId}
          updatedAt={release.data?.updatedAt}
          uploadBlocked={upload.isPending || save.isPending || publish.isPending}
          uploadError={upload.error}
          uploadPending={upload.isPending}
        />
        <PackageEditorSection
          editable={editable}
          onDirty={() => setDirty(true)}
          packages={packages}
          setPackages={setPackages}
          setTierPackageIndexes={setTierPackageIndexes}
        />
        <TierRulesSection
          editable={editable}
          packages={packages}
          setTierPackageIndexes={setTierPackageIndexes}
          tierPackageIndexes={tierPackageIndexes}
        />
        <ClaimFieldsSection
          editable={editable}
          fields={fields}
          onDirty={() => setDirty(true)}
          setFields={setFields}
        />

        {editable ? (
          <div className="editor-bottom-actions">
            <button
              className="button primary large"
              disabled={save.isPending || publish.isPending || upload.isPending}
              type="submit"
            >
              {save.isPending ? '正在保存…' : isNew ? '创建草稿' : '保存草稿'}
            </button>
            {!isNew ? (
              <button
                className="button ghost danger"
                disabled={remove.isPending}
                onClick={() => setConfirmation('delete')}
                type="button"
              >
                删除草稿
              </button>
            ) : null}
          </div>
        ) : null}
      </form>
      <ConfirmDialog
        busy={publish.isPending}
        confirmLabel="发布并生成礼物单"
        description={`发布会原子保存当前页面中的全部内容，并冻结这份礼物配置。发布后不能再编辑。${publicVisible ? '这份礼物会同时展示在公开首页。' : '这份礼物不会展示在公开首页。'}`}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => publish.mutate()}
        open={confirmation === 'publish'}
        title="确认发布当前内容？"
      />
      <ConfirmDialog
        busy={close.isPending}
        confirmLabel="关闭发布"
        description="关闭后将停止展示为当前发布，已经生成的礼物单不受影响。"
        onCancel={() => setConfirmation(null)}
        onConfirm={() => close.mutate()}
        open={confirmation === 'close'}
        title="确认关闭这次发布？"
        tone="danger"
      />
      <ConfirmDialog
        busy={remove.isPending}
        confirmLabel="删除草稿"
        description="这份尚未发布的礼物草稿会被永久删除。"
        onCancel={() => setConfirmation(null)}
        onConfirm={() => remove.mutate()}
        open={confirmation === 'delete'}
        title="确认删除草稿？"
        tone="danger"
      />
      <ConfirmDialog
        confirmLabel="放弃修改"
        description="当前页面还有未保存的内容，离开后这些修改会丢失。"
        onCancel={() => blocker.reset?.()}
        onConfirm={() => blocker.proceed?.()}
        open={blocker.state === 'blocked'}
        title="离开当前编辑页？"
        tone="danger"
      />
    </div>
  );
}
