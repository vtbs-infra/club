import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';

import {
  createAdminCreator,
  getAdminCreators,
  getAdminUsers,
  refreshAdminCreatorProfile,
  updateAdminCreator,
  type CreatorRecord,
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
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import { formatDate } from '../../lib/format';
import { monthlySyncPresentation } from '../../lib/status-presentation';

interface CreatorFormState {
  monthlySyncEnabled: boolean;
  timezone: string;
  userId: string;
}

const emptyForm: CreatorFormState = {
  monthlySyncEnabled: true,
  timezone: 'Asia/Shanghai',
  userId: '',
};

function creatorForm(creator: CreatorRecord): CreatorFormState {
  return {
    monthlySyncEnabled: creator.monthlySyncEnabled,
    timezone: creator.timezone,
    userId: creator.userId,
  };
}

function sameForm(left: CreatorFormState, right: CreatorFormState): boolean {
  return (
    left.monthlySyncEnabled === right.monthlySyncEnabled &&
    left.timezone === right.timezone &&
    left.userId === right.userId
  );
}

export function AdminCreatorsPage() {
  const queryClient = useQueryClient();
  const editorRef = useRef<HTMLFormElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const timezoneInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<CreatorRecord | null>(null);
  const [form, setForm] = useState<CreatorFormState>(emptyForm);
  const [baselineForm, setBaselineForm] = useState<CreatorFormState>(emptyForm);
  const unsavedChanges = useUnsavedChangesGuard(!sameForm(form, baselineForm));
  const creators = useInfiniteQuery({
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => getAdminCreators({ cursor: pageParam }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    queryKey: ['admin', 'creators'],
  });
  const users = useQuery({
    enabled: search.trim().length > 0,
    queryFn: () => getAdminUsers(search),
    queryKey: ['admin', 'users', search],
    retry: false,
  });
  const focusEditor = (mode: 'create' | 'edit') => {
    requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({ block: 'start' });
      (mode === 'edit' ? timezoneInputRef.current : searchInputRef.current)?.focus();
    });
  };
  const startEditing = (creator: CreatorRecord) => {
    unsavedChanges.requestDiscard(() => {
      const nextForm = creatorForm(creator);
      setEditing(creator);
      setForm(nextForm);
      setBaselineForm(nextForm);
      focusEditor('edit');
    });
  };
  const reset = () => {
    setEditing(null);
    setForm(emptyForm);
    setBaselineForm(emptyForm);
  };
  const startNew = () => {
    unsavedChanges.requestDiscard(() => {
      reset();
      focusEditor('create');
    });
  };
  const refreshQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin', 'creators'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] }),
    ]);
  };
  const save = useMutation({
    mutationFn: () =>
      editing
        ? updateAdminCreator(editing.id, {
            monthlySyncEnabled: form.monthlySyncEnabled,
            timezone: form.timezone,
          })
        : createAdminCreator({
            monthlySyncEnabled: form.monthlySyncEnabled,
            timezone: form.timezone,
            userId: form.userId,
          }),
    onSuccess: async () => {
      reset();
      await refreshQueries();
    },
  });
  const refreshProfile = useMutation({
    mutationFn: () => refreshAdminCreatorProfile(editing!.id),
    onSuccess: async (updated) => {
      const nextForm = creatorForm(updated);
      setEditing(updated);
      setForm(nextForm);
      setBaselineForm(nextForm);
      await refreshQueries();
    },
  });

  if (creators.isPending) return <LoadingState label="正在读取主播…" />;
  if (creators.isError) return <ErrorState error={creators.error} />;
  const creatorItems = creators.data.pages.flatMap((page) => page.items);
  const eligibleUsers =
    users.data?.filter((user) => user.role === 'USER' && user.bilibiliBinding !== null) ?? [];
  const selectedUser = eligibleUsers.find((user) => user.id === form.userId) ?? null;
  return (
    <div className="stack-lg">
      <PageHeader
        actions={
          <button className="button primary" onClick={startNew} type="button">
            注册主播
          </button>
        }
        eyebrow="主播账号"
        intro="从已完成 B站验证的普通用户中注册主播；身份资料由平台从 B站读取。"
        title="主播"
      />
      <div className="split-workspace creator-admin-workspace">
        <section className="panel list-panel">
          <div className="section-heading compact">
            <div>
              <h2>已注册主播</h2>
              <p>已加载 {creatorItems.length} 位主播</p>
            </div>
          </div>
          {creatorItems.length === 0 ? (
            <EmptyState description="从右侧选择一个已验证用户开始注册。" title="还没有主播" />
          ) : (
            <div className="creator-admin-list">
              {creatorItems.map((creator) => (
                <button
                  className={
                    editing?.id === creator.id ? 'creator-admin-row selected' : 'creator-admin-row'
                  }
                  key={creator.id}
                  onClick={() => startEditing(creator)}
                  type="button"
                >
                  <span className="mini-avatar">{creator.displayName.slice(0, 1)}</span>
                  <span>
                    <strong>{creator.displayName}</strong>
                    <small>{creator.email}</small>
                  </span>
                  <StatusBadge
                    {...monthlySyncPresentation[
                      creator.monthlySyncEnabled ? 'enabled' : 'disabled'
                    ]}
                  />
                </button>
              ))}
              {creators.hasNextPage ? (
                <button
                  className="button ghost small"
                  disabled={creators.isFetchingNextPage}
                  onClick={() => void creators.fetchNextPage()}
                  type="button"
                >
                  {creators.isFetchingNextPage ? '正在加载…' : '加载更多主播'}
                </button>
              ) : null}
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
              <p className="eyebrow">{editing ? '主播设置' : '注册主播'}</p>
              <h2>{editing?.displayName ?? '选择已验证账号'}</h2>
            </div>
            {editing ? (
              <button className="text-button" onClick={startNew} type="button">
                新建
              </button>
            ) : null}
          </div>
          {!editing ? (
            <>
              <label>
                搜索已验证用户
                <input
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setForm((current) => ({ ...current, userId: '' }));
                  }}
                  placeholder="输入昵称、邮箱、B站昵称或 UID"
                  ref={searchInputRef}
                  value={search}
                />
              </label>
              <label>
                普通用户账号
                <select
                  disabled={users.isPending || users.isError || !search.trim()}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, userId: event.target.value }))
                  }
                  required
                  value={form.userId}
                >
                  <option value="">请选择</option>
                  {eligibleUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name} · UID {user.bilibiliBinding!.biliUid}
                    </option>
                  ))}
                </select>
                <small>这里只显示已完成 B站验证的普通用户。</small>
              </label>
              {users.isPending && search.trim() ? (
                <p className="quiet-line">正在搜索已验证用户…</p>
              ) : null}
              {users.isError ? (
                <div className="stack-sm">
                  <ErrorNotice error={users.error} />
                  <button
                    className="button ghost small"
                    onClick={() => void users.refetch()}
                    type="button"
                  >
                    重新搜索
                  </button>
                </div>
              ) : null}
              {!search.trim() ? (
                <InlineNotice tone="info">输入昵称、邮箱、B站昵称或 UID 开始搜索。</InlineNotice>
              ) : users.isSuccess && eligibleUsers.length === 0 ? (
                <InlineNotice tone="info">没有找到可注册的已验证普通用户。</InlineNotice>
              ) : null}
              {selectedUser ? (
                <div className="readonly-account">
                  <span>B站身份</span>
                  <strong>
                    {selectedUser.bilibiliBinding!.biliDisplayName ??
                      `UID ${selectedUser.bilibiliBinding!.biliUid}`}
                  </strong>
                  <small>
                    UID {selectedUser.bilibiliBinding!.biliUid} · {selectedUser.email}
                  </small>
                </div>
              ) : null}
            </>
          ) : (
            <div className="readonly-account">
              <span>B站身份</span>
              <strong>{editing.displayName}</strong>
              <small>
                UID {editing.bilibiliUid} · 直播间 {editing.roomId}
              </small>
              <small>最近同步：{formatDate(editing.profileSyncedAt, true)}</small>
              <button
                className="button secondary"
                disabled={refreshProfile.isPending}
                onClick={() => refreshProfile.mutate()}
                type="button"
              >
                {refreshProfile.isPending ? '正在刷新…' : '刷新 B站资料'}
              </button>
            </div>
          )}
          <label>
            名单结算时区
            <input
              maxLength={100}
              onChange={(event) =>
                setForm((current) => ({ ...current, timezone: event.target.value }))
              }
              ref={timezoneInputRef}
              required
              value={form.timezone}
            />
            <small>使用 IANA 时区，例如 Asia/Shanghai。</small>
          </label>
          <label className="switch-field">
            <input
              checked={form.monthlySyncEnabled}
              onChange={(event) =>
                setForm((current) => ({ ...current, monthlySyncEnabled: event.target.checked }))
              }
              type="checkbox"
            />
            <span>
              <strong>参与月末名单同步</strong>
              <small>关闭后只停止未来任务，不影响主播账号、历史数据和公开礼物。</small>
            </span>
          </label>
          {save.isError ? <ErrorNotice error={save.error} /> : null}
          {refreshProfile.isError ? <ErrorNotice error={refreshProfile.error} /> : null}
          <button className="button primary" disabled={save.isPending} type="submit">
            {save.isPending ? '正在保存…' : editing ? '保存名单设置' : '注册为主播'}
          </button>
        </form>
      </div>
      <ConfirmDialog
        confirmLabel="放弃修改"
        description="当前主播配置还有未保存的内容，继续后这些修改会丢失。"
        onCancel={unsavedChanges.cancelDiscard}
        onConfirm={unsavedChanges.confirmDiscard}
        open={unsavedChanges.blocked}
        title="放弃当前主播修改？"
        tone="danger"
      />
    </div>
  );
}
