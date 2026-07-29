import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';

import {
  createManagedAnnouncement,
  deleteManagedAnnouncement,
  getIdentity,
  getManagedAnnouncements,
  updateManagedAnnouncement,
  type Announcement,
  type ManagedAnnouncementInput,
} from '../api/client';
import { dateTimeLocalToIso, isoToDateTimeLocal, PLATFORM_TIME_ZONE } from '../lib/date-time';
import { formatDate } from '../lib/format';
import {
  ConfirmDialog,
  EmptyState,
  ErrorNotice,
  ErrorState,
  LoadingState,
  StatusBadge,
} from './Ui';

const emptyDraft: ManagedAnnouncementInput = {
  body: '',
  expiresAt: null,
  pinned: false,
  publishNow: false,
  severity: 'INFO',
  title: '',
};

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
  const [draft, setDraft] = useState<ManagedAnnouncementInput>(emptyDraft);
  const [deleteConfirmation, setDeleteConfirmation] = useState<string | null>(null);
  const timeZone =
    area === 'creator'
      ? (identity.data?.creator?.timezone ?? PLATFORM_TIME_ZONE)
      : PLATFORM_TIME_ZONE;
  const focusEditor = () => {
    requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      titleInputRef.current?.focus();
    });
  };
  const reset = () => {
    setEditing(null);
    setDraft(emptyDraft);
  };
  const save = useMutation({
    mutationFn: () =>
      editing
        ? updateManagedAnnouncement(area, editing.id, {
            ...draft,
            expectedVersion: editing.version,
          })
        : createManagedAnnouncement(area, draft),
    onSuccess: async () => {
      reset();
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

  if (announcements.isPending) return <LoadingState />;
  if (announcements.isError) return <ErrorState error={announcements.error} />;

  return (
    <div className="split-workspace announcement-workspace">
      <section className="panel list-panel">
        <div className="section-heading compact">
          <div>
            <h2>公告列表</h2>
            <p>草稿仅自己可见，发布后立即出现在相关用户的资讯中。</p>
          </div>
          <button
            className="button secondary"
            onClick={() => {
              reset();
              focusEditor();
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
                onClick={() => {
                  setEditing(announcement);
                  setDraft({
                    body: announcement.body,
                    expiresAt: announcement.expiresAt,
                    pinned: announcement.pinned,
                    publishNow: announcement.publishedAt !== null,
                    severity: announcement.severity,
                    title: announcement.title,
                  });
                  focusEditor();
                }}
                type="button"
              >
                <span>
                  <StatusBadge status={announcement.publishedAt ? 'published' : 'draft'}>
                    {announcement.publishedAt ? '已发布' : '草稿'}
                  </StatusBadge>
                  {announcement.pinned ? <small>置顶</small> : null}
                </span>
                <strong>{announcement.title}</strong>
                <small>
                  {announcement.publishedAt
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
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
            required
            ref={titleInputRef}
            value={draft.title}
          />
        </label>
        <label>
          正文
          <textarea
            maxLength={20_000}
            onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))}
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
                setDraft((current) => ({
                  ...current,
                  severity: event.target.value as ManagedAnnouncementInput['severity'],
                }))
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
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  expiresAt: event.target.value
                    ? dateTimeLocalToIso(event.target.value, timeZone)
                    : null,
                }))
              }
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
              onChange={(event) =>
                setDraft((current) => ({ ...current, pinned: event.target.checked }))
              }
              type="checkbox"
            />
            置顶显示
          </label>
          <label className="check-field">
            <input
              checked={draft.publishNow}
              onChange={(event) =>
                setDraft((current) => ({ ...current, publishNow: event.target.checked }))
              }
              type="checkbox"
            />
            保存后立即发布
          </label>
        </div>
        {save.isError ? <ErrorNotice error={save.error} /> : null}
        {remove.isError ? <ErrorNotice error={remove.error} /> : null}
        <div className="form-actions">
          <button className="button primary" disabled={save.isPending} type="submit">
            {save.isPending ? '正在保存…' : '保存公告'}
          </button>
          {editing && !editing.publishedAt ? (
            <button
              className="button ghost danger"
              disabled={remove.isPending}
              onClick={() => setDeleteConfirmation(editing.id)}
              type="button"
            >
              删除草稿
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
    </div>
  );
}
