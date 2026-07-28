import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  approveAdminRoster,
  getAdminRoster,
  getAdminRosters,
  rejectAdminRoster,
  retryAdminRoster,
} from '../../api/client';
import {
  EmptyState,
  ErrorState,
  InlineNotice,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '../../components/Ui';
import { formatDate, formatMonth } from '../../lib/format';

const statusLabel: Readonly<Record<string, string>> = {
  FAILED: '失败',
  FINALIZED: '已冻结',
  PENDING_APPROVAL: '待确认',
  REJECTED: '已拒绝',
  RUNNING: '同步中',
  SCHEDULED: '已计划',
};

export function AdminRostersPage() {
  const queryClient = useQueryClient();
  const [parameters, setParameters] = useSearchParams();
  const runId = parameters.get('run');
  const rosters = useQuery({ queryFn: getAdminRosters, queryKey: ['admin', 'rosters'] });
  const detail = useQuery({
    enabled: Boolean(runId),
    queryFn: () => getAdminRoster(runId!),
    queryKey: ['admin', 'rosters', runId],
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
    onSuccess: refresh,
  });
  const selected = useMemo(
    () => rosters.data?.find(({ run }) => run.id === runId),
    [rosters.data, runId],
  );
  if (rosters.isPending) return <LoadingState label="正在读取名单任务…" />;
  if (rosters.isError) return <ErrorState error={rosters.error} />;
  const mutationError = retry.error ?? approve.error ?? reject.error;
  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="ROSTER SYNC"
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
                  onClick={() => setParameters({ run: run.id }, { replace: true })}
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
        <section className="panel roster-detail-panel">
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
              {mutationError ? (
                <InlineNotice tone="danger">{mutationError.message}</InlineNotice>
              ) : null}
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
                      onClick={() => {
                        const reason = window.prompt('请输入拒绝原因：');
                        if (reason) reject.mutate(reason);
                      }}
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
                            <strong>{attempt.failureCode}</strong>：{attempt.failureMessage}
                          </InlineNotice>
                        ) : null}
                      </article>
                    ))
                  )}
                </div>
              </div>
              {detail.data.pages.length > 0 ? (
                <details className="evidence-details">
                  <summary>原始分页证据摘要（{detail.data.pages.length} 页）</summary>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>页码</th>
                        <th>成员数</th>
                        <th>内容哈希</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.data.pages.map((page) => (
                        <tr key={page.pageNumber}>
                          <td>{page.pageNumber}</td>
                          <td>{page.itemCount}</td>
                          <td>
                            <code>{page.contentHashSha256.slice(0, 16)}…</code>
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
    </div>
  );
}
