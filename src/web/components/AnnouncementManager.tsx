import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';

import {
  createManagedAnnouncement,
  deleteManagedAnnouncement,
  getIdentity,
  getManagedAnnouncements,
  publishManagedAnnouncement,
  saveManagedAnnouncement,
  withdrawManagedAnnouncement,
  type Announcement,
  type AnnouncementContent,
} from '../api/client';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import { dateTimeLocalToIso, isoToDateTimeLocal, PLATFORM_TIME_ZONE } from '../lib/date-time';
import { formatDate } from '../lib/format';
import { announcementStatePresentation } from '../lib/status-presentation';
import {
  ConfirmDialog,
  EmptyState,
  ErrorNotice,
  ErrorState,
  InlineNotice,
  LoadingState,
  StatusBadge,
} from './Ui';

const emptyDraft: AnnouncementContent = {
  body: '',
  expiresAt: null,
  pinned: false,
  publicVisible: false,
  severity: 'INFO',
  title: '',
};

function announcementDraft(announcement: Announcement): AnnouncementContent {
  return {
    body: announcement.body,
    expiresAt: announcement.expiresAt,
    pinned: announcement.pinned,
    publicVisible: announcement.publicVisible,
    severity: announcement.severity,
    title: announcement.title,
  };
}

function sameDraft(left: AnnouncementContent, right: AnnouncementContent): boolean {
  return (
    left.body === right.body &&
    left.expiresAt === right.expiresAt &&
    left.pinned === right.pinned &&
    left.publicVisible === right.publicVisible &&
    left.severity === right.severity &&
    left.title === right.title
  );
}

function announcementValidationMessage(
  draft: AnnouncementContent,
  editing: Announcement | null,
  publishing = false,
): string | null {
  if (!draft.title.trim()) return '公告标题不能只包含空格。';
  if (!draft.body.trim()) return '公告正文不能只包含空格。';
  if (!draft.expiresAt) return null;
  const expiresAt = Date.parse(draft.expiresAt);
  if (Number.isNaN(expiresAt)) return '公告失效时间格式不正确。';
  const publishedAt = publishing
    ? Date.now()
    : editing?.publishedAt
      ? Date.parse(editing.publishedAt)
      : null;
  if (publishedAt !== null && expiresAt <= publishedAt) {
    return '公告失效时间必须晚于发布时间。';
  }
  return null;
}

export function AnnouncementManager({ area }: { readonly area: 'admin' | 'creator' }) {
  const queryClient = useQueryClient();
  const editorRef = useRef<HTMLFormElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const queryKey = [area, 'announcements'] as const;
  const announcements = useQuery({
    queryFn: () => getManagedAnnouncements(area),
    queryKey,
  });
  const identity = useQuery({
    enabled: area === 'creator',
    queryFn: getIdentity,
    queryKey: ['identity'],
  });
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [draft, setDraft] = useState<AnnouncementContent>(emptyDraft);
  const [baselineDraft, setBaselineDraft] = useState<AnnouncementContent>(emptyDraft);
  const [deleteConfirmation, setDeleteConfirmation] = useState<string | null>(null);
  const [publishConfirmation, setPublishConfirmation] = useState(false);
  const [withdrawConfirmation, setWithdrawConfirmation] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const dirty = !sameDraft(draft, baselineDraft);
  const unsavedChanges = useUnsavedChangesGuard(dirty);
  const timeZone =
    area === 'creator'
      ? (identity.data?.creator?.timezone ?? PLATFORM_TIME_ZONE)
      : PLATFORM_TIME_ZONE;
  const updateDraft = (patch: Partial<AnnouncementContent>) => {
    setValidationError(null);
    setDraft((current) => ({ ...current, ...patch }));
  };
  const focusEditor = () => {
    requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({ block: 'start' });
      titleInputRef.current?.focus();
    });
  };
  const reset = () => {
    setEditing(null);
    setDraft(emptyDraft);
    setBaselineDraft(emptyDraft);
    setPublishConfirmation(false);
    setWithdrawConfirmation(false);
    setValidationError(null);
  };
  const selectAnnouncement = (announcement: Announcement) => {
    const nextDraft = announcementDraft(announcement);
    setEditing(announcement);
    setDraft(nextDraft);
    setBaselineDraft(nextDraft);
    setValidationError(null);
    focusEditor();
  };
  const acceptAnnouncement = (announcement: Announcement) => {
    const nextDraft = announcementDraft(announcement);
    setEditing(announcement);
    setDraft(nextDraft);
    setBaselineDraft(nextDraft);
    setPublishConfirmation(false);
    setWithdrawConfirmation(false);
    setValidationError(null);
  };
  const save = useMutation({
    mutationFn: () =>
      editing
        ? saveManagedAnnouncement(area, editing.id, {
            ...draft,
            expectedVersion: editing.version,
          })
        : createManagedAnnouncement(area, draft),
    onSuccess: async (announcement) => {
      acceptAnnouncement(announcement);
      await queryClient.invalidateQueries({ queryKey });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteManagedAnnouncement(area, id),
    onSuccess: () => {
      setDeleteConfirmation(null);
      reset();
      return queryClient.invalidateQueries({ queryKey });
    },
  });
  const publish = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error('No announcement is selected.');
      return publishManagedAnnouncement(area, editing.id, editing.version);
    },
    onSuccess: async (announcement) => {
      acceptAnnouncement(announcement);
      await queryClient.invalidateQueries({ queryKey });
    },
  });
  const withdraw = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error('No announcement is selected.');
      return withdrawManagedAnnouncement(area, editing.id, editing.version);
    },
    onSuccess: async (announcement) => {
      acceptAnnouncement(announcement);
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  if (announcements.isPending) return <LoadingState />;
  if (announcements.isError) return <ErrorState error={announcements.error} />;

  return (
    <div className="split-workspace announcement-workspace">
      <section className="panel list-panel">
        <div className="section-heading compact">
          <div>
            <h2>公告列表</h2>
            <p>
              {area === 'admin'
                ? '发布后面向所有已登录用户；只有明确开启公开展示时才会进入首页。'
                : '发布后出现在拥有你当前或历史礼物单的用户资讯中。'}
            </p>
          </div>
          <button
            className="button secondary"
            onClick={() => {
              unsavedChanges.requestDiscard(() => {
                reset();
                focusEditor();
              });
            }}
            type="button"
          >
            新建公告
          </button>
        </div>
        {announcements.data.length === 0 ? (
          <EmptyState description="发布第一条公告后会显示在这里。" title="暂无公告" />
        ) : (
          <div className="managed-list">
            {announcements.data.map((announcement) => (
              <button
                className={editing?.id === announcement.id ? 'managed-row selected' : 'managed-row'}
                key={announcement.id}
                onClick={() =>
                  unsavedChanges.requestDiscard(() => selectAnnouncement(announcement))
                }
                type="button"
              >
                <span>
                  <StatusBadge {...announcementStatePresentation[announcement.status]} />
                  {announcement.pinned ? <small>置顶</small> : null}
                </span>
                <strong>{announcement.title}</strong>
                <small>
                  {announcement.status === 'WITHDRAWN' && announcement.withdrawnAt
                    ? formatDate(announcement.withdrawnAt, true)
                    : announcement.publishedAt
                      ? formatDate(announcement.publishedAt, true)
                      : formatDate(announcement.createdAt, true)}
                </small>
              </button>
            ))}
          </div>
        )}
      </section>
      <form
        className="panel editor-panel"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          const message = announcementValidationMessage(draft, editing);
          setValidationError(message);
          if (message) return;
          save.mutate();
        }}
        ref={editorRef}
      >
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">{editing ? '编辑公告' : '新建公告'}</p>
            <h2>{editing?.title ?? '填写公告内容'}</h2>
          </div>
        </div>
        <label>
          标题
          <input
            maxLength={200}
            onChange={(event) => updateDraft({ title: event.target.value })}
            required
            ref={titleInputRef}
            value={draft.title}
          />
        </label>
        <label>
          正文
          <textarea
            maxLength={20_000}
            onChange={(event) => updateDraft({ body: event.target.value })}
            required
            rows={10}
            value={draft.body}
          />
        </label>
        <div className="form-grid">
          <label>
            提醒级别
            <select
              onChange={(event) =>
                updateDraft({
                  severity: event.target.value as AnnouncementContent['severity'],
                })
              }
              value={draft.severity}
            >
              <option value="INFO">普通资讯</option>
              <option value="WARNING">重要提醒</option>
              <option value="CRITICAL">紧急通知</option>
            </select>
          </label>
          <label>
            失效时间（可选）
            <input
              onChange={(event) => {
                if (!event.target.value) {
                  updateDraft({ expiresAt: null });
                  return;
                }
                try {
                  const expiresAt = dateTimeLocalToIso(event.target.value, timeZone);
                  updateDraft({ expiresAt });
                } catch {
                  setValidationError(`这个时间在 ${timeZone} 时区中不存在，请重新选择。`);
                }
              }}
              type="datetime-local"
              value={draft.expiresAt ? isoToDateTimeLocal(draft.expiresAt, timeZone) : ''}
            />
            <small>时区：{timeZone}</small>
          </label>
        </div>
        <div className="check-row">
          <label className="check-field">
            <input
              checked={draft.pinned}
              onChange={(event) => updateDraft({ pinned: event.target.checked })}
              type="checkbox"
            />
            置顶显示
          </label>
          {area === 'admin' ? (
            <label className="check-field">
              <input
                checked={draft.publicVisible}
                onChange={(event) => updateDraft({ publicVisible: event.target.checked })}
                type="checkbox"
              />
              同时展示在公开首页
            </label>
          ) : null}
        </div>
        {validationError ? (
          <InlineNotice tone="danger">
            <p>{validationError}</p>
          </InlineNotice>
        ) : null}
        {save.isError ? <ErrorNotice error={save.error} /> : null}
        {remove.isError ? <ErrorNotice error={remove.error} /> : null}
        {publish.isError ? <ErrorNotice error={publish.error} /> : null}
        {withdraw.isError ? <ErrorNotice error={withdraw.error} /> : null}
        <div className="form-actions">
          <button className="button primary" disabled={save.isPending} type="submit">
            {save.isPending ? '正在保存…' : editing ? '保存修改' : '保存草稿'}
          </button>
          {editing?.status === 'DRAFT' ? (
            <button
              className="button ghost danger"
              disabled={remove.isPending}
              onClick={() => setDeleteConfirmation(editing.id)}
              type="button"
            >
              删除草稿
            </button>
          ) : null}
          {editing && (editing.status === 'DRAFT' || editing.status === 'WITHDRAWN') ? (
            <button
              className="button secondary"
              disabled={publish.isPending || dirty}
              onClick={() => {
                const message = announcementValidationMessage(draft, editing, true);
                setValidationError(message);
                if (!message) setPublishConfirmation(true);
              }}
              title={dirty ? '请先保存或放弃当前修改' : undefined}
              type="button"
            >
              {editing.status === 'WITHDRAWN' ? '重新发布' : '发布公告'}
            </button>
          ) : null}
          {editing?.status === 'PUBLISHED' ? (
            <button
              className="button ghost danger"
              disabled={withdraw.isPending || dirty}
              onClick={() => setWithdrawConfirmation(true)}
              title={dirty ? '请先保存或放弃当前修改' : undefined}
              type="button"
            >
              撤下公告
            </button>
          ) : null}
        </div>
      </form>
      <ConfirmDialog
        busy={remove.isPending}
        confirmLabel="删除草稿"
        description="这份尚未发布的公告草稿会被永久删除。"
        onCancel={() => setDeleteConfirmation(null)}
        onConfirm={() => {
          if (deleteConfirmation) remove.mutate(deleteConfirmation);
        }}
        open={deleteConfirmation !== null}
        title="确认删除公告草稿？"
        tone="danger"
      />
      <ConfirmDialog
        busy={publish.isPending}
        confirmLabel={editing?.status === 'WITHDRAWN' ? '重新发布' : '发布公告'}
        description={
          editing?.status === 'WITHDRAWN'
            ? '公告会以新版本重新发布，并对用户显示为未读。'
            : '公告会立即对目标用户可见；平台公告仅在开启公开展示时进入首页。'
        }
        onCancel={() => setPublishConfirmation(false)}
        onConfirm={() => publish.mutate()}
        open={publishConfirmation}
        title={editing?.status === 'WITHDRAWN' ? '确认重新发布这条公告？' : '确认发布这条公告？'}
      />
      <ConfirmDialog
        busy={withdraw.isPending}
        confirmLabel="撤下公告"
        description="公告会从用户资讯和公开首页中撤下，保留为不可删除的已撤下公告。"
        onCancel={() => setWithdrawConfirmation(false)}
        onConfirm={() => withdraw.mutate()}
        open={withdrawConfirmation}
        title="确认撤下这条公告？"
        tone="danger"
      />
      <ConfirmDialog
        confirmLabel="放弃修改"
        description="当前公告还有未保存的内容，继续后这些修改会丢失。"
        onCancel={unsavedChanges.cancelDiscard}
        onConfirm={unsavedChanges.confirmDiscard}
        open={unsavedChanges.blocked}
        title="放弃当前公告修改？"
        tone="danger"
      />
    </div>
  );
}
