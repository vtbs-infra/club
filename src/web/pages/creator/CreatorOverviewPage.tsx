import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Clock3, Cloud, Gift, Plus, Truck } from 'lucide-react';
import { Link } from 'react-router-dom';

import {
  getCreatorOrders,
  getCreatorReleases,
  getCreatorRosters,
  getIdentity,
} from '../../api/client';
import { ErrorState, LoadingState, MetricCard, PageHeader, StatusBadge } from '../../components/Ui';
import { formatDate, formatMonth } from '../../lib/format';

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
  if (identity.isPending || releases.isPending || orders.isPending || rosters.isPending) {
    return <LoadingState label="正在准备主播工作台…" />;
  }
  if (identity.isError || releases.isError || orders.isError || rosters.isError) {
    return <ErrorState error={identity.error ?? releases.error ?? orders.error ?? rosters.error} />;
  }
  const activeRelease = releases.data.find((release) => release.status === 'PUBLISHED');
  const waiting = orders.data.filter((order) => order.status === 'SUBMITTED').length;
  const shipped = orders.data.filter((order) => order.status === 'SHIPPED').length;
  const nextRoster = rosters.data
    .filter((roster) => roster.status === 'SCHEDULED')
    .sort(
      (left, right) =>
        new Date(left.scheduledCutoffAt).getTime() - new Date(right.scheduledCutoffAt).getTime(),
    )[0];
  const latestRoster = [...rosters.data].sort((left, right) =>
    right.periodStart.localeCompare(left.periodStart),
  )[0];

  return (
    <div className="stack-xl">
      <PageHeader
        eyebrow="主播工作台"
        intro={`欢迎回来，${identity.data.creator?.displayName ?? identity.data.user.name}。`}
        title="主播概览"
        actions={
          <Link className="button primary" to="/creator/releases/new">
            创建礼物发布
            <Plus aria-hidden="true" size={16} />
          </Link>
        }
      />
      <section className="metric-grid">
        <MetricCard
          description="等待录入运单"
          icon={Clock3}
          label="待发货"
          tone={waiting > 0 ? 'amber' : 'blue'}
          value={waiting}
        />
        <MetricCard
          description="已发货礼物单"
          icon={Truck}
          label="运输中"
          tone="violet"
          value={shipped}
        />
        <MetricCard
          description="历史发布总数"
          icon={Gift}
          label="礼物发布"
          value={releases.data.length}
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
          {nextRoster ? (
            <div className="cutoff-card">
              <span>下一次名单冻结</span>
              <strong>{formatDate(nextRoster.scheduledCutoffAt, true)}</strong>
              <p>
                {formatMonth(nextRoster.periodStart)}资格 · {identity.data.creator?.timezone}
              </p>
            </div>
          ) : (
            <p className="quiet-line">系统正在准备下一次月末名单任务。</p>
          )}
          {latestRoster ? (
            <div className="latest-run">
              <span>最近任务</span>
              <strong>{formatMonth(latestRoster.periodStart)}</strong>
              <StatusBadge status={latestRoster.status}>
                {latestRoster.status === 'FINALIZED'
                  ? '已冻结'
                  : latestRoster.status === 'PENDING_APPROVAL'
                    ? '等待平台确认'
                    : latestRoster.status === 'FAILED'
                      ? '同步失败'
                      : '已计划'}
              </StatusBadge>
            </div>
          ) : null}
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
          {activeRelease ? (
            <div className="active-release-card">
              <StatusBadge status={activeRelease.status}>已发布</StatusBadge>
              <h3>{activeRelease.title}</h3>
              <p>{formatMonth(activeRelease.eligibilityMonth)}资格</p>
              <dl>
                <div>
                  <dt>待领取</dt>
                  <dd>
                    {
                      orders.data.filter(
                        (order) =>
                          order.release.id === activeRelease.id && order.status === 'CLAIMABLE',
                      ).length
                    }
                  </dd>
                </div>
                <div>
                  <dt>已提交</dt>
                  <dd>
                    {
                      orders.data.filter(
                        (order) =>
                          order.release.id === activeRelease.id &&
                          order.status !== 'CLAIMABLE' &&
                          order.status !== 'EXPIRED',
                      ).length
                    }
                  </dd>
                </div>
              </dl>
              <Link className="button secondary" to={`/creator/releases/${activeRelease.id}`}>
                查看发布
              </Link>
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
        {waiting === 0 ? (
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
