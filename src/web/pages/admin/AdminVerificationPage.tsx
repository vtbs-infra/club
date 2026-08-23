import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';

import {
  createVerificationRoom,
  getVerificationRooms,
  testVerificationRoom,
  updateVerificationRoom,
  type VerificationRoom,
} from '../../api/client';
import {
  EmptyState,
  ConfirmDialog,
  ErrorNotice,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '../../components/Ui';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import { roomHealthPresentation } from '../../lib/status-presentation';

interface RoomForm {
  biliRoomId: string;
  displayName: string;
  enabled: boolean;
  priority: number;
}

const emptyRoom: RoomForm = {
  biliRoomId: '',
  displayName: '',
  enabled: true,
  priority: 100,
};

function roomForm(room: VerificationRoom): RoomForm {
  return {
    biliRoomId: room.biliRoomId,
    displayName: room.displayName,
    enabled: room.enabled,
    priority: room.priority,
  };
}

function sameForm(left: RoomForm, right: RoomForm): boolean {
  return (
    left.biliRoomId === right.biliRoomId &&
    left.displayName === right.displayName &&
    left.enabled === right.enabled &&
    left.priority === right.priority
  );
}

export function AdminVerificationPage() {
  const queryClient = useQueryClient();
  const editorRef = useRef<HTMLFormElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const rooms = useQuery({
    queryFn: getVerificationRooms,
    queryKey: ['admin', 'verification'],
  });
  const [editing, setEditing] = useState<VerificationRoom | null>(null);
  const [form, setForm] = useState<RoomForm>(emptyRoom);
  const [baselineForm, setBaselineForm] = useState<RoomForm>(emptyRoom);
  const unsavedChanges = useUnsavedChangesGuard(!sameForm(form, baselineForm));
  const focusEditor = () => {
    requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      nameInputRef.current?.focus();
    });
  };
  const startEditing = (room: VerificationRoom) => {
    unsavedChanges.requestDiscard(() => {
      const nextForm = roomForm(room);
      setEditing(room);
      setForm(nextForm);
      setBaselineForm(nextForm);
      focusEditor();
    });
  };
  const reset = () => {
    setEditing(null);
    setForm(emptyRoom);
    setBaselineForm(emptyRoom);
  };
  const startNew = () => {
    unsavedChanges.requestDiscard(() => {
      reset();
      focusEditor();
    });
  };
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'verification'] });
  const save = useMutation({
    mutationFn: () =>
      editing
        ? updateVerificationRoom(editing.id, {
            displayName: form.displayName,
            enabled: form.enabled,
            priority: form.priority,
          })
        : createVerificationRoom(form),
    onSuccess: async () => {
      reset();
      await refresh();
    },
  });
  const test = useMutation({
    mutationFn: testVerificationRoom,
    onSuccess: refresh,
  });
  if (rooms.isPending) return <LoadingState label="正在读取验证直播间…" />;
  if (rooms.isError) return <ErrorState error={rooms.error} />;
  return (
    <div className="stack-lg">
      <PageHeader
        actions={
          <button className="button primary" onClick={startNew} type="button">
            添加直播间
          </button>
        }
        eyebrow="B站验证"
        intro="普通用户只能使用这里启用的固定直播间，不能自行输入房间号。"
        title="验证直播间"
      />
      <div className="split-workspace verification-workspace">
        <section className="panel list-panel">
          <div className="section-heading compact">
            <div>
              <h2>已配置直播间</h2>
              <p>优先级数字越小越优先分配。</p>
            </div>
          </div>
          {rooms.data.length === 0 ? (
            <EmptyState
              description="至少启用一个房间后，用户才能创建验证码。"
              title="尚未配置验证直播间"
            />
          ) : (
            <div className="room-list">
              {rooms.data.map((room) => (
                <button
                  className={editing?.id === room.id ? 'room-row selected' : 'room-row'}
                  key={room.id}
                  onClick={() => startEditing(room)}
                  type="button"
                >
                  <span>
                    <strong>{room.displayName}</strong>
                    <small>
                      直播间 {room.biliRoomId} · 优先级 {room.priority}
                    </small>
                  </span>
                  <StatusBadge {...roomHealthPresentation(room.healthStatus, room.enabled)} />
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
              <p className="eyebrow">{editing ? '编辑直播间' : '添加直播间'}</p>
              <h2>{editing?.displayName ?? '验证连接配置'}</h2>
            </div>
            {editing ? (
              <button className="text-button" onClick={startNew} type="button">
                新建
              </button>
            ) : null}
          </div>
          <label>
            显示名称
            <input
              maxLength={120}
              onChange={(event) =>
                setForm((current) => ({ ...current, displayName: event.target.value }))
              }
              placeholder="例如：Club 主验证直播间"
              ref={nameInputRef}
              required
              value={form.displayName}
            />
          </label>
          <div className="form-grid">
            <label>
              直播间 ID
              <input
                disabled={editing !== null}
                inputMode="numeric"
                maxLength={32}
                onChange={(event) =>
                  setForm((current) => ({ ...current, biliRoomId: event.target.value }))
                }
                pattern="[0-9]+"
                required
                value={form.biliRoomId}
              />
            </label>
            <label>
              分配优先级
              <input
                max={10_000}
                min={0}
                onChange={(event) =>
                  setForm((current) => ({ ...current, priority: Number(event.target.value) }))
                }
                type="number"
                value={form.priority}
              />
            </label>
          </div>
          <label className="switch-field">
            <input
              checked={form.enabled}
              onChange={(event) =>
                setForm((current) => ({ ...current, enabled: event.target.checked }))
              }
              type="checkbox"
            />
            <span>
              <strong>允许分配给用户</strong>
              <small>停用不会删除历史验证记录。</small>
            </span>
          </label>
          {save.isError || test.isError ? <ErrorNotice error={save.error ?? test.error} /> : null}
          <div className="form-actions">
            <button className="button primary" disabled={save.isPending} type="submit">
              {save.isPending ? '正在保存…' : '保存配置'}
            </button>
            {editing ? (
              <button
                className="button secondary"
                disabled={test.isPending}
                onClick={() => test.mutate(editing.id)}
                type="button"
              >
                {test.isPending ? '正在测试…' : '测试连接'}
              </button>
            ) : null}
          </div>
        </form>
      </div>
      <ConfirmDialog
        confirmLabel="放弃修改"
        description="当前直播间配置还有未保存的内容，继续后这些修改会丢失。"
        onCancel={unsavedChanges.cancelDiscard}
        onConfirm={unsavedChanges.confirmDiscard}
        open={unsavedChanges.blocked}
        title="放弃当前直播间修改？"
        tone="danger"
      />
    </div>
  );
}
