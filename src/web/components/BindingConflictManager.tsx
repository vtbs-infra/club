import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
  dismissAdminBindingConflict,
  getAdminBindingConflicts,
  resolveAdminBindingConflict,
  type BindingConflict,
} from '../api/client';
import { formatDate } from '../lib/format';
import { ConfirmDialog, ErrorNotice, ErrorState, LoadingState } from './Ui';

type ConflictAction = 'DISMISS' | 'RESOLVE';

interface PendingAction {
  readonly conflict: BindingConflict;
  readonly type: ConflictAction;
}

export function BindingConflictManager() {
  const queryClient = useQueryClient();
  const [cursor, setCursor] = useState<string | undefined>();
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [reason, setReason] = useState('');
  const conflicts = useQuery({
    queryFn: () => getAdminBindingConflicts(cursor),
    queryKey: ['admin', 'binding-conflicts', cursor],
  });
  const closeDialog = () => {
    setPendingAction(null);
    setReason('');
  };
  const action = useMutation({
    mutationFn: async (input: PendingAction & { readonly reason: string }) => {
      const payload = { reason: input.reason };
      return input.type === 'RESOLVE'
        ? resolveAdminBindingConflict(input.conflict.id, payload)
        : dismissAdminBindingConflict(input.conflict.id, payload);
    },
    onSuccess: async () => {
      closeDialog();
      setCursor(undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'binding-conflicts'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] }),
      ]);
    },
  });
  const openAction = (conflict: BindingConflict, type: ConflictAction) => {
    action.reset();
    setReason('');
    setPendingAction({ conflict, type });
  };
  const selected = pendingAction?.conflict;
  const resolving = pendingAction?.type === 'RESOLVE';

  return (
    <section className="panel">
      <div className="section-heading compact">
        <div>
          <p className="eyebrow">绑定冲突</p>
          <h2>待处理的 UID 归属请求</h2>
          <p>逐项核对申请账号与冲突发生时的原绑定，再决定解除原绑定或驳回请求。</p>
        </div>
      </div>
      {conflicts.isPending ? (
        <LoadingState label="正在读取绑定冲突…" />
      ) : conflicts.isError || !conflicts.data ? (
        <ErrorState
          error={conflicts.error}
          onRetry={() => void conflicts.refetch()}
          retryLabel="重试冲突列表"
          title="绑定冲突暂时无法加载"
        />
      ) : conflicts.data.items.length === 0 ? (
        <p className="quiet-line">当前没有待处理的绑定冲突。</p>
      ) : (
        <>
          <div className="orders-table-wrap">
            <table className="data-table binding-conflict-table">
              <thead>
                <tr>
                  <th>申请账号</th>
                  <th>验证 UID</th>
                  <th>冲突发生时的原绑定</th>
                  <th>收到时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {conflicts.data.items.map((conflict) => (
                  <tr key={conflict.id}>
                    <td>
                      <strong>{conflict.requestingUser.name}</strong>
                      <small>{conflict.requestingUser.email}</small>
                    </td>
                    <td>
                      <code>{conflict.biliUid}</code>
                    </td>
                    <td>
                      <strong>
                        {conflict.observedBinding.biliDisplayName ??
                          `UID ${conflict.observedBinding.biliUid}`}
                      </strong>
                      <small>
                        {conflict.observedBinding.user.name} · {conflict.observedBinding.user.email}
                      </small>
                      {conflict.observedBinding.unboundAt ? (
                        <small>
                          原绑定已于 {formatDate(conflict.observedBinding.unboundAt, true)} 解除
                        </small>
                      ) : null}
                    </td>
                    <td>{formatDate(conflict.createdAt, true)}</td>
                    <td>
                      <div className="conflict-actions">
                        <button
                          className="button primary compact"
                          onClick={() => openAction(conflict, 'RESOLVE')}
                          type="button"
                        >
                          {conflict.observedBinding.unboundAt ? '标记已解决' : '解除原绑定'}
                        </button>
                        <button
                          className="button ghost compact"
                          onClick={() => openAction(conflict, 'DISMISS')}
                          type="button"
                        >
                          驳回请求
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="form-actions conflict-pagination">
            {cursor ? (
              <button className="button ghost" onClick={() => setCursor(undefined)} type="button">
                返回最新请求
              </button>
            ) : null}
            {conflicts.data.nextCursor ? (
              <button
                className="button secondary"
                disabled={conflicts.isFetching}
                onClick={() => setCursor(conflicts.data.nextCursor!)}
                type="button"
              >
                {conflicts.isFetching ? '正在加载…' : '查看更早请求'}
              </button>
            ) : null}
          </div>
        </>
      )}
      <ConfirmDialog
        busy={action.isPending}
        confirmDisabled={reason.trim().length < 3}
        confirmLabel={resolving ? '确认解决' : '确认驳回'}
        description={
          selected ? (
            <div className="stack-md">
              <p>
                {resolving
                  ? selected.observedBinding.unboundAt
                    ? '冲突发生时的原绑定已经解除。本操作只会结束这项请求，不会查找或影响后来建立的其他绑定。'
                    : `将解除 ${selected.observedBinding.user.name} 当时持有的原绑定；UID 不会自动转交，申请账号仍需重新验证。`
                  : '这会保留现状并结束本次请求；申请账号会看到请求未通过。'}
              </p>
              <label>
                处理原因
                <textarea
                  maxLength={500}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="请记录核对结果或处理依据"
                  rows={4}
                  value={reason}
                />
                <small>至少 3 个字符；原因会写入审计记录。</small>
              </label>
              {action.isError ? <ErrorNotice error={action.error} /> : null}
            </div>
          ) : null
        }
        onCancel={closeDialog}
        onConfirm={() => {
          if (pendingAction) action.mutate({ ...pendingAction, reason: reason.trim() });
        }}
        open={pendingAction !== null}
        title={resolving ? '解决这项 UID 冲突？' : '驳回这项 UID 归属请求？'}
        tone={resolving ? 'primary' : 'danger'}
      />
    </section>
  );
}
