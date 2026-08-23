import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Clock3, Cloud, Gift, Plus, Truck } from 'lucide-react';
import { Link } from 'react-router-dom';

import {
  getCreatorOrders,
  getCreatorReleases,
  getCreatorRosters,
  getIdentity,
} from '../../api/client';
import {
  ErrorNotice,
  ErrorState,
  LoadingState,
  MetricCard,
  PageHeader,
  StatusBadge,
} from '../../components/Ui';
import { formatDate, formatMonth } from '../../lib/format';
import { giftReleasePresentation, snapshotRunPresentation } from '../../lib/status-presentation';

export function CreatorOverviewPage() {
  const identity = useQuery({ queryFn: getIdentity, queryKey: ['identity'] });
  const releases = useQuery({
    queryFn: getCreatorReleases,
    queryKey: ['creator', 'releases'],
  });
  const orders = useQuery({ queryFn: () => getCreatorOrders(), queryKey: ['creator', 'orders'] });
  const rosters = useQuery({
    queryFn: getCreatorRosters,
    queryKey: ['creator', 'rosters'],
  });
  const activeRelease = releases.data?.find((release) => release.status === 'PUBLISHED');
  const waiting = orders.data?.filter((order) => order.status === 'SUBMITTED').length ?? 0;
  const shipped = orders.data?.filter((order) => order.status === 'SHIPPED').length ?? 0;
  const nextRoster = (rosters.data ?? [])
    .filter((roster) => roster.status === 'SCHEDULED')
    .sort(
      (left, right) =>
        new Date(left.scheduledCutoffAt).getTime() - new Date(right.scheduledCutoffAt).getTime(),
    )[0];
  const latestRoster = [...(rosters.data ?? [])].sort((left, right) =>
    right.periodStart.localeCompare(left.periodStart),
  )[0];

  return (
    <div className="stack-xl">
      <PageHeader
        eyebrow="主播工作台"
        intro={
          identity.data
            ? `欢迎回来，${identity.data.creator?.displayName ?? identity.data.user.name}。`
            : identity.isPending
              ? '正在读取主播资料…'
              : '主播资料暂时无法读取。'
        }
        title="主播概览"
        actions={
          <Link className="button primary" to="/creator/releases/new">
            创建礼物发布
            <Plus aria-hidden="true" size={16} />
          </Link>
        }
      />
      {identity.isError ? (
        <ErrorState
          error={identity.error}
          onRetry={() => void identity.refetch()}
          retryLabel="重试主播资料"
          title="主播资料暂时无法加载"
        />
      ) : null}
      <section className="metric-grid">
        <MetricCard
          description={
            orders.isPending
              ? '正在读取礼物单'
              : orders.isError
                ? '礼物单数据暂时不可用'
                : '等待录入运单'
          }
          icon={Clock3}
          label="待发货"
          tone={orders.isError ? 'red' : waiting > 0 ? 'amber' : 'blue'}
          value={orders.data ? waiting : '—'}
        />
        <MetricCard
          description={
            orders.isPending
              ? '正在读取礼物单'
              : orders.isError
                ? '礼物单数据暂时不可用'
                : '已发货礼物单'
          }
          icon={Truck}
          label="运输中"
          tone={orders.isError ? 'red' : 'violet'}
          value={orders.data ? shipped : '—'}
        />
        <MetricCard
          description={
            releases.isPending
              ? '正在读取发布数据'
              : releases.isError
                ? '发布数据暂时不可用'
                : '历史发布总数'
          }
          icon={Gift}
          label="礼物发布"
          tone={releases.isError ? 'red' : 'blue'}
          value={releases.data?.length ?? '—'}
        />
      </section>

      <div className="overview-grid">
        <section className="panel">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">月度资格</p>
              <h2>月末名单</h2>
            </div>
            <Link className="text-action" to="/creator/settings">
              查看设置
              <ArrowRight aria-hidden="true" size={15} />
            </Link>
          </div>
          {rosters.isPending ? (
            <LoadingState label="正在读取名单任务…" />
          ) : rosters.isError ? (
            <ErrorState error={rosters.error} onRetry={() => void rosters.refetch()} />
          ) : (
            <>
              {nextRoster ? (
                <div className="cutoff-card">
                  <span>下一次名单冻结</span>
                  <strong>{formatDate(nextRoster.scheduledCutoffAt, true)}</strong>
                  <p>
                    {formatMonth(nextRoster.periodStart)}资格 ·{' '}
                    {identity.data?.creator?.timezone ?? '时区读取中'}
                  </p>
                </div>
              ) : (
                <p className="quiet-line">系统正在准备下一次月末名单任务。</p>
              )}
              {latestRoster ? (
                <div className="latest-run">
                  <span>最近任务</span>
                  <strong>{formatMonth(latestRoster.periodStart)}</strong>
                  <StatusBadge {...snapshotRunPresentation(latestRoster.status)} />
                </div>
              ) : null}
            </>
          )}
        </section>
        <section className="panel">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">当前发布</p>
              <h2>当前礼物发布</h2>
            </div>
            <Link className="text-action" to="/creator/releases">
              全部发布
              <ArrowRight aria-hidden="true" size={15} />
            </Link>
          </div>
          {releases.isPending ? (
            <LoadingState label="正在读取礼物发布…" />
          ) : releases.isError ? (
            <ErrorState error={releases.error} onRetry={() => void releases.refetch()} />
          ) : activeRelease ? (
            <div className="active-release-card">
              <StatusBadge {...giftReleasePresentation[activeRelease.status]} />
              <h3>{activeRelease.title}</h3>
              <p>{formatMonth(activeRelease.eligibilityMonth)}资格</p>
              <dl>
                <div>
                  <dt>待领取</dt>
                  <dd>
                    {orders.data?.filter(
                      (order) =>
                        order.release.id === activeRelease.id && order.status === 'CLAIMABLE',
                    ).length ?? '—'}
                  </dd>
                </div>
                <div>
                  <dt>已提交</dt>
                  <dd>
                    {orders.data?.filter(
                      (order) =>
                        order.release.id === activeRelease.id &&
                        order.status !== 'CLAIMABLE' &&
                        order.status !== 'EXPIRED',
                    ).length ?? '—'}
                  </dd>
                </div>
              </dl>
              <Link className="button secondary" to={`/creator/releases/${activeRelease.id}`}>
                查看发布
              </Link>
              {orders.isError ? (
                <div className="stack-md">
                  <ErrorNotice error={orders.error} />
                  <button
                    className="button secondary small"
                    onClick={() => void orders.refetch()}
                    type="button"
                  >
                    重试礼物单数据
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="calm-empty">
              <span>
                <Cloud aria-hidden="true" size={25} />
              </span>
              <strong>当前没有正在领取的礼物</strong>
              <p>这完全正常。需要发放礼物时再创建发布即可。</p>
            </div>
          )}
        </section>
      </div>

      <section className="panel">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">发货履约</p>
            <h2>待办礼物单</h2>
          </div>
          <Link className="text-action" to="/creator/orders">
            进入礼物单
            <ArrowRight aria-hidden="true" size={15} />
          </Link>
        </div>
        {orders.isPending ? (
          <LoadingState label="正在读取待办礼物单…" />
        ) : orders.isError ? (
          <ErrorState error={orders.error} onRetry={() => void orders.refetch()} />
        ) : waiting === 0 ? (
          <p className="quiet-line">目前没有待发货的礼物单。</p>
        ) : (
          <div className="task-strips">
            {waiting > 0 ? (
              <Link to="/creator/orders?status=SUBMITTED">
                <strong>{waiting}</strong>
                <span>份礼物等待发货</span>
                <b>
                  去发货
                  <ArrowRight aria-hidden="true" size={15} />
                </b>
              </Link>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
