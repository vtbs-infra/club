import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';

import {
  createAdminCreator,
  getAdminCreators,
  getAdminUsers,
  updateAdminCreator,
  type CreatorRecord,
} from '../../api/client';
import {
  EmptyState,
  ErrorNotice,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '../../components/Ui';

interface CreatorFormState {
  active: boolean;
  bilibiliUid: string;
  displayName: string;
  roomId: string;
  timezone: string;
  userId: string;
}

const emptyForm: CreatorFormState = {
  active: true,
  bilibiliUid: '',
  displayName: '',
  roomId: '',
  timezone: 'Asia/Shanghai',
  userId: '',
};

export function AdminCreatorsPage() {
  const queryClient = useQueryClient();
  const displayNameInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLFormElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<CreatorRecord | null>(null);
  const [form, setForm] = useState<CreatorFormState>(emptyForm);
  const creators = useQuery({ queryFn: getAdminCreators, queryKey: ['admin', 'creators'] });
  const users = useQuery({
    queryFn: () => getAdminUsers(search),
    queryKey: ['admin', 'users', search],
  });
  const focusEditor = () => {
    requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      (searchInputRef.current ?? displayNameInputRef.current)?.focus();
    });
  };
  const startEditing = (creator: CreatorRecord) => {
    setEditing(creator);
    setForm({
      active: creator.active,
      bilibiliUid: creator.bilibiliUid,
      displayName: creator.displayName,
      roomId: creator.roomId,
      timezone: creator.timezone,
      userId: creator.userId,
    });
    focusEditor();
  };
  const reset = () => {
    setEditing(null);
    setForm(emptyForm);
  };
  const startNew = () => {
    reset();
    focusEditor();
  };
  const save = useMutation({
    mutationFn: () =>
      editing
        ? updateAdminCreator(editing.id, {
            active: form.active,
            bilibiliUid: form.bilibiliUid,
            displayName: form.displayName,
            roomId: form.roomId,
            timezone: form.timezone,
          })
        : createAdminCreator({
            bilibiliUid: form.bilibiliUid,
            displayName: form.displayName,
            roomId: form.roomId,
            timezone: form.timezone,
            userId: form.userId,
          }),
    onSuccess: async () => {
      reset();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'creators'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] }),
      ]);
    },
  });

  if (creators.isPending) return <LoadingState label="正在读取主播…" />;
  if (creators.isError) return <ErrorState error={creators.error} />;
  const eligibleUsers = users.data?.filter((user) => user.role === 'USER') ?? [];
  return (
    <div className="stack-lg">
      <PageHeader
        actions={
          <button className="button primary" onClick={startNew} type="button">
            注册主播
          </button>
        }
        eyebrow="主播账号"
        intro="选择一个已有普通用户账号，将其提升为主播并绑定唯一主播档案。"
        title="主播"
      />
      <div className="split-workspace creator-admin-workspace">
        <section className="panel list-panel">
          <div className="section-heading compact">
            <div>
              <h2>已注册主播</h2>
              <p>{creators.data.length} 位主播</p>
            </div>
          </div>
          {creators.data.length === 0 ? (
            <EmptyState description="从右侧选择一个普通用户账号开始注册。" title="还没有主播" />
          ) : (
            <div className="creator-admin-list">
              {creators.data.map((creator) => (
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
                  <StatusBadge status={creator.active ? 'active' : 'inactive'}>
                    {creator.active ? '启用' : '停用'}
                  </StatusBadge>
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
              <p className="eyebrow">{editing ? '编辑主播' : '注册主播'}</p>
              <h2>{editing?.displayName ?? '关联用户账号'}</h2>
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
                搜索用户
                <input
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="输入昵称或邮箱"
                  ref={searchInputRef}
                  value={search}
                />
              </label>
              <label>
                普通用户账号
                <select
                  onChange={(event) =>
                    setForm((current) => ({ ...current, userId: event.target.value }))
                  }
                  required
                  value={form.userId}
                >
                  <option value="">请选择</option>
                  {eligibleUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name} · {user.email}
                    </option>
                  ))}
                </select>
                <small>注册后该账号将直接进入主播工作台。</small>
              </label>
            </>
          ) : (
            <div className="readonly-account">
              <span>登录账号</span>
              <strong>{editing.userName}</strong>
              <small>{editing.email}</small>
            </div>
          )}
          <div className="form-grid">
            <label>
              主播显示名称
              <input
                maxLength={120}
                onChange={(event) =>
                  setForm((current) => ({ ...current, displayName: event.target.value }))
                }
                required
                ref={displayNameInputRef}
                value={form.displayName}
              />
            </label>
            <label>
              B站 UID
              <input
                inputMode="numeric"
                onChange={(event) =>
                  setForm((current) => ({ ...current, bilibiliUid: event.target.value }))
                }
                pattern="[0-9]+"
                required
                value={form.bilibiliUid}
              />
            </label>
            <label>
              直播间 ID
              <input
                inputMode="numeric"
                onChange={(event) =>
                  setForm((current) => ({ ...current, roomId: event.target.value }))
                }
                pattern="[0-9]+"
                required
                value={form.roomId}
              />
            </label>
            <label>
              名单结算时区
              <input
                onChange={(event) =>
                  setForm((current) => ({ ...current, timezone: event.target.value }))
                }
                required
                value={form.timezone}
              />
              <small>使用 IANA 时区，例如 Asia/Shanghai。</small>
            </label>
          </div>
          {editing ? (
            <label className="switch-field">
              <input
                checked={form.active}
                onChange={(event) =>
                  setForm((current) => ({ ...current, active: event.target.checked }))
                }
                type="checkbox"
              />
              <span>
                <strong>启用月末名单同步</strong>
                <small>停用后不再为未来月份创建任务。</small>
              </span>
            </label>
          ) : null}
          {save.isError ? <ErrorNotice error={save.error} /> : null}
          <button className="button primary" disabled={save.isPending} type="submit">
            {save.isPending ? '正在保存…' : editing ? '保存主播设置' : '注册为主播'}
          </button>
        </form>
      </div>
    </div>
  );
}
