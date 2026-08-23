import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  approveAdminRoster,
  getAdminRoster,
  getAdminRosterIntegrity,
  getAdminRosters,
  rejectAdminRoster,
  retryAdminRoster,
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
import { formatDate, formatMonth } from '../../lib/format';

const statusLabel: Readonly<Record<string, string>> = {
  CANCELLED: '已取消',
  FAILED: '失败',
  FINALIZED: '已冻结',
  PENDING_APPROVAL: '待确认',
  REJECTED: '已拒绝',
  RUNNING: '同步中',
  SCHEDULED: '已计划',
};

const failureLabel: Readonly<Record<string, string>> = {
  CAPTURE_ATTEMPT_LIMIT_REACHED: '已达到最大同步次数',
  DUPLICATE_MEMBER: '名单中存在重复 UID',
  INVALID_TIER: '名单包含无法识别的舰队等级',
  PAGE_LIMIT_EXCEEDED: '来源返回的分页数量异常',
  PROVIDER_ERROR: 'B站名单来源请求失败',
  TOTAL_MISMATCH: '分页汇总人数与来源声明不一致',
};

export function AdminRostersPage() {
  const queryClient = useQueryClient();
  const detailRef = useRef<HTMLElement>(null);
  const [parameters, setParameters] = useSearchParams();
  const runId = parameters.get('run');
  const [memberSearch, setMemberSearch] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const rosters = useQuery({ queryFn: getAdminRosters, queryKey: ['admin', 'rosters'] });
  const detail = useQuery({
    enabled: Boolean(runId),
    queryFn: () => getAdminRoster(runId!),
    queryKey: ['admin', 'rosters', runId],
  });
  const integrity = useQuery({
    enabled: false,
    queryFn: () => getAdminRosterIntegrity(runId!),
    queryKey: ['admin', 'rosters', runId, 'integrity'],
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin', 'rosters'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] }),
    ]);
  };
  const retry = useMutation({ mutationFn: () => retryAdminRoster(runId!), onSuccess: refresh });
  const approve = useMutation({ mutationFn: () => approveAdminRoster(runId!), onSuccess: refresh });
  const reject = useMutation({
    mutationFn: (reason: string) => rejectAdminRoster(runId!, reason),
    onSuccess: async () => {
      setRejectOpen(false);
      setRejectReason('');
      await refresh();
    },
  });
  const selected = useMemo(
    () => rosters.data?.find(({ run }) => run.id === runId),
    [rosters.data, runId],
  );
  const filteredMembers = useMemo(() => {
    const normalized = memberSearch.trim().toLowerCase();
    if (!normalized) return detail.data?.members ?? [];
    return (
      detail.data?.members.filter(
        (member) =>
          member.biliUid.includes(normalized) ||
          member.displayNameAtSnapshot?.toLowerCase().includes(normalized),
      ) ?? []
    );
  }, [detail.data?.members, memberSearch]);
  const selectRun = (id: string) => {
    setMemberSearch('');
    setRejectOpen(false);
    setRejectReason('');
    setParameters({ run: id }, { replace: true });
  };

  useEffect(() => {
    if (!runId || !window.matchMedia('(max-width: 920px)').matches) return;
    requestAnimationFrame(() =>
      detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  }, [runId]);
  if (rosters.isPending) return <LoadingState label="正在读取名单任务…" />;
  if (rosters.isError) return <ErrorState error={rosters.error} />;
  const mutationError = retry.error ?? approve.error ?? reject.error;
  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="月度名单"
        intro="每位启用主播都会按配置时区在月末 23:59 开始抓取；迟到名单必须由平台确认。"
        title="名单同步"
      />
      <div className="roster-workspace">
        <section className="panel roster-list-panel">
          <div className="section-heading compact">
            <div>
              <h2>月度任务</h2>
              <p>{rosters.data.length} 个任务</p>
            </div>
          </div>
          {rosters.data.length === 0 ? (
            <EmptyState
              description="启用主播后，系统会自动准备当前月和下月任务。"
              title="暂无名单任务"
            />
          ) : (
            <div className="roster-run-list">
              {rosters.data.map(({ creator, run }) => (
                <button
                  className={run.id === runId ? 'roster-run selected' : 'roster-run'}
                  key={run.id}
                  onClick={() => selectRun(run.id)}
                  type="button"
                >
                  <span>
                    <strong>{creator.displayName}</strong>
                    <small>{formatMonth(run.periodStart)}</small>
                  </span>
                  <StatusBadge status={run.status}>
                    {statusLabel[run.status] ?? run.status}
                  </StatusBadge>
                  <time>{formatDate(run.scheduledCutoffAt, true)}</time>
                </button>
              ))}
            </div>
          )}
        </section>
        <section className="panel roster-detail-panel" ref={detailRef}>
          {!runId ? (
            <EmptyState
              description="从左侧选择一个任务查看抓取结果与证据摘要。"
              title="选择名单任务"
            />
          ) : detail.isPending ? (
            <LoadingState />
          ) : detail.isError || !detail.data || !selected ? (
            <ErrorState error={detail.error} />
          ) : (
            <div className="stack-lg">
              <div className="section-heading compact">
                <div>
                  <p className="eyebrow">{selected.creator.displayName}</p>
                  <h2>{formatMonth(detail.data.run.periodStart)}名单</h2>
                </div>
                <StatusBadge status={detail.data.run.status}>
                  {statusLabel[detail.data.run.status] ?? detail.data.run.status}
                </StatusBadge>
              </div>
              <dl className="detail-grid">
                <div>
                  <dt>计划开始</dt>
                  <dd>{formatDate(detail.data.run.scheduledCutoffAt, true)}</dd>
                </div>
                <div>
                  <dt>准点窗口结束</dt>
                  <dd>{formatDate(detail.data.run.onTimeWindowEndAt, true)}</dd>
                </div>
                <div>
                  <dt>冻结时间</dt>
                  <dd>
                    {detail.data.run.finalizedAt
                      ? formatDate(detail.data.run.finalizedAt, true)
                      : '尚未冻结'}
                  </dd>
                </div>
                <div>
                  <dt>执行次数</dt>
                  <dd>{detail.data.attempts.length}</dd>
                </div>
              </dl>
              {mutationError ? <ErrorNotice error={mutationError} /> : null}
              {detail.data.run.status === 'PENDING_APPROVAL' ? (
                <div className="decision-card">
                  <div>
                    <strong>这是一次迟到但一致的抓取</strong>
                    <p>
                      确认后，该次返回名单将成为不可变的月度资格快照，并触发已发布礼物的礼物单生成。
                    </p>
                  </div>
                  <div>
                    <button
                      className="button primary"
                      disabled={approve.isPending}
                      onClick={() => approve.mutate()}
                      type="button"
                    >
                      确认并冻结
                    </button>
                    <button
                      className="button ghost danger"
                      disabled={reject.isPending}
                      onClick={() => setRejectOpen(true)}
                      type="button"
                    >
                      拒绝此次抓取
                    </button>
                  </div>
                </div>
              ) : detail.data.run.status === 'FAILED' ? (
                <div className="decision-card danger">
                  <div>
                    <strong>名单同步失败</strong>
                    <p>检查最近一次错误后，可重新执行。每个任务最多保留三次尝试。</p>
                  </div>
                  <button
                    className="button primary"
                    disabled={retry.isPending}
                    onClick={() => retry.mutate()}
                    type="button"
                  >
                    重新同步
                  </button>
                </div>
              ) : null}
              <div>
                <h3>执行记录</h3>
                <div className="attempt-list">
                  {detail.data.attempts.length === 0 ? (
                    <p className="quiet-line">尚未开始抓取。</p>
                  ) : (
                    detail.data.attempts.map((attempt) => (
                      <article key={attempt.attemptNumber}>
                        <header>
                          <strong>第 {attempt.attemptNumber} 次</strong>
                          <StatusBadge status={attempt.consistencyStatus}>
                            {attempt.consistencyStatus === 'CONSISTENT'
                              ? '一致'
                              : attempt.consistencyStatus === 'INCONSISTENT'
                                ? '不一致'
                                : '进行中'}
                          </StatusBadge>
                        </header>
                        <dl>
                          <div>
                            <dt>时效</dt>
                            <dd>
                              {attempt.punctuality === 'ON_TIME'
                                ? '准点'
                                : attempt.punctuality === 'LATE'
                                  ? '迟到'
                                  : '—'}
                            </dd>
                          </div>
                          <div>
                            <dt>返回总数</dt>
                            <dd>{attempt.normalizedTotal ?? '—'}</dd>
                          </div>
                          <div>
                            <dt>完成时间</dt>
                            <dd>
                              {attempt.captureCompletedAt
                                ? formatDate(attempt.captureCompletedAt, true)
                                : '—'}
                            </dd>
                          </div>
                        </dl>
                        {attempt.failureCode ? (
                          <InlineNotice tone="danger">
                            <strong>
                              {failureLabel[attempt.failureCode] ?? '名单同步未能完成'}
                            </strong>
                            <details className="error-details">
                              <summary>错误详情</summary>
                              <p>
                                {attempt.failureCode}
                                {attempt.failureMessage ? ` · ${attempt.failureMessage}` : ''}
                              </p>
                            </details>
                          </InlineNotice>
                        ) : null}
                      </article>
                    ))
                  )}
                </div>
              </div>
              {detail.data.members.length > 0 ? (
                <div className="stack-md">
                  <div className="section-heading compact">
                    <div>
                      <h3>定稿成员</h3>
                      <p>{detail.data.members.length} 个不可变资格成员</p>
                    </div>
                    <label className="compact-search">
                      <span className="sr-only">搜索 UID 或昵称</span>
                      <input
                        onChange={(event) => setMemberSearch(event.target.value)}
                        placeholder="搜索 UID 或昵称"
                        type="search"
                        value={memberSearch}
                      />
                    </label>
                  </div>
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>序号</th>
                          <th>UID</th>
                          <th>抓取时昵称</th>
                          <th>资格等级</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredMembers.map((member) => (
                          <tr key={member.id}>
                            <td>{member.sourcePosition}</td>
                            <td>
                              <code>{member.biliUid}</code>
                            </td>
                            <td>{member.displayNameAtSnapshot ?? '—'}</td>
                            <td>
                              {member.tier === 'CAPTAIN'
                                ? '舰长'
                                : member.tier === 'ADMIRAL'
                                  ? '提督'
                                  : '总督'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {filteredMembers.length === 0 ? (
                    <p className="quiet-line">没有符合当前搜索条件的成员。</p>
                  ) : null}
                </div>
              ) : null}
              {detail.data.pages.length > 0 ? (
                <details className="evidence-details">
                  <summary>原始分页证据（{detail.data.pages.length} 页）</summary>
                  <div className="form-actions evidence-actions">
                    <button
                      className="button secondary"
                      disabled={integrity.isFetching}
                      onClick={() => void integrity.refetch()}
                      type="button"
                    >
                      {integrity.isFetching ? '正在校验…' : '校验证据完整性'}
                    </button>
                    {integrity.data ? (
                      <StatusBadge
                        status={integrity.data.every((result) => result.ok) ? 'ok' : 'failed'}
                      >
                        {integrity.data.every((result) => result.ok)
                          ? '全部哈希一致'
                          : '发现不一致'}
                      </StatusBadge>
                    ) : null}
                  </div>
                  {integrity.isError ? <ErrorNotice error={integrity.error} /> : null}
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>执行</th>
                        <th>页码</th>
                        <th>成员数</th>
                        <th>内容哈希</th>
                        <th>校验</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.data.pages.map((page) => (
                        <tr key={`${page.snapshotAttemptId}-${page.pageNumber}`}>
                          <td>
                            第{' '}
                            {detail.data.attempts.find(
                              (attempt) => attempt.id === page.snapshotAttemptId,
                            )?.attemptNumber ?? '—'}{' '}
                            次
                          </td>
                          <td>{page.pageNumber}</td>
                          <td>{page.itemCount}</td>
                          <td>
                            <code>{page.contentHashSha256.slice(0, 16)}…</code>
                          </td>
                          <td>
                            {integrity.data
                              ? integrity.data.find(
                                  (result) =>
                                    result.snapshotAttemptId === page.snapshotAttemptId &&
                                    result.pageNumber === page.pageNumber,
                                )?.ok
                                ? '一致'
                                : '不一致'
                              : '未校验'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              ) : null}
            </div>
          )}
        </section>
      </div>
      <ConfirmDialog
        busy={reject.isPending}
        confirmDisabled={rejectReason.trim().length < 3}
        confirmLabel="拒绝此次抓取"
        description={
          <label>
            拒绝原因
            <textarea
              maxLength={500}
              onChange={(event) => setRejectReason(event.target.value)}
              placeholder="请说明本次名单不能定稿的原因"
              rows={4}
              value={rejectReason}
            />
            <small>至少 3 个字符；原因会写入审计记录。</small>
          </label>
        }
        onCancel={() => setRejectOpen(false)}
        onConfirm={() => reject.mutate(rejectReason.trim())}
        open={rejectOpen}
        title="拒绝迟到名单"
        tone="danger"
      />
    </div>
  );
}
