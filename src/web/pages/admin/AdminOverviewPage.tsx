import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import {
  getAdminCreators,
  getAdminOverview,
  getAdminRosters,
  getVerificationRooms,
} from '../../api/client';
import { ErrorState, LoadingState, PageHeader, StatusBadge } from '../../components/Ui';
import { formatDate, formatMonth } from '../../lib/format';

export function AdminOverviewPage() {
  const overview = useQuery({ queryFn: getAdminOverview, queryKey: ['admin', 'overview'] });
  const creators = useQuery({ queryFn: getAdminCreators, queryKey: ['admin', 'creators'] });
  const rosters = useQuery({ queryFn: getAdminRosters, queryKey: ['admin', 'rosters'] });
  const rooms = useQuery({ queryFn: getVerificationRooms, queryKey: ['admin', 'verification'] });
  if (overview.isPending || creators.isPending || rosters.isPending || rooms.isPending) {
    return <LoadingState label="正在准备平台概览…" />;
  }
  if (overview.isError || creators.isError || rosters.isError || rooms.isError) {
    return <ErrorState error={overview.error ?? creators.error ?? rosters.error ?? rooms.error} />;
  }
  const pendingApproval = rosters.data.filter(({ run }) => run.status === 'PENDING_APPROVAL');
  const failures = rosters.data.filter(({ run }) => run.status === 'FAILED');
  const unhealthyRooms = rooms.data.filter(
    (room) => room.enabled && room.healthStatus !== 'HEALTHY',
  );
  const verificationNeedsSetup = !rooms.data.some((room) => room.enabled);
  return (
    <div className="stack-xl">
      <PageHeader
        eyebrow="PLATFORM OVERVIEW"
        intro="只关注平台级配置、名单异常和验证直播间健康状态。"
        title="平台概览"
      />
      <section className="metric-grid">
        <article>
          <span className="metric-icon">人</span>
          <div>
            <small>注册主播</small>
            <strong>{overview.data.creators}</strong>
            <p>{overview.data.activeCreators} 位启用中</p>
          </div>
        </article>
        <article>
          <span className="metric-icon">月</span>
          <div>
            <small>待确认名单</small>
            <strong>{pendingApproval.length}</strong>
            <p>迟到抓取需要人工决定</p>
          </div>
        </article>
        <article>
          <span className="metric-icon">!</span>
          <div>
            <small>同步失败</small>
            <strong>{failures.length}</strong>
            <p>等待检查或重试</p>
          </div>
        </article>
        <article>
          <span className="metric-icon">验</span>
          <div>
            <small>验证直播间异常</small>
            <strong>{unhealthyRooms.length}</strong>
            <p>{rooms.data.length} 个房间已配置</p>
          </div>
        </article>
      </section>
      {pendingApproval.length > 0 ||
      failures.length > 0 ||
      unhealthyRooms.length > 0 ||
      verificationNeedsSetup ? (
        <section className="panel attention-panel">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">NEEDS ATTENTION</p>
              <h2>需要处理</h2>
            </div>
          </div>
          <div className="attention-list">
            {verificationNeedsSetup ? (
              <Link to="/admin/verification">
                <span className="attention-icon warning">验</span>
                <div>
                  <strong>需要配置验证直播间</strong>
                  <p>至少启用一个房间后，普通用户才能绑定 B站 UID。</p>
                </div>
                <b>去配置 →</b>
              </Link>
            ) : null}
            {pendingApproval.map(({ creator, run }) => (
              <Link key={run.id} to={`/admin/rosters?run=${run.id}`}>
                <span className="attention-icon warning">!</span>
                <div>
                  <strong>
                    {creator.displayName} 的 {formatMonth(run.periodStart)}名单等待确认
                  </strong>
                  <p>抓取开始时间已超过月末准点窗口。</p>
                </div>
                <b>处理 →</b>
              </Link>
            ))}
            {failures.map(({ creator, run }) => (
              <Link key={run.id} to={`/admin/rosters?run=${run.id}`}>
                <span className="attention-icon danger">×</span>
                <div>
                  <strong>{creator.displayName} 的名单同步失败</strong>
                  <p>{formatDate(run.scheduledCutoffAt, true)} 计划执行</p>
                </div>
                <b>查看 →</b>
              </Link>
            ))}
            {unhealthyRooms.map((room) => (
              <Link key={room.id} to="/admin/verification">
                <span className="attention-icon warning">◌</span>
                <div>
                  <strong>验证直播间“{room.displayName}”未处于健康状态</strong>
                  <p>当前状态：{room.healthStatus}</p>
                </div>
                <b>检查 →</b>
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <section className="all-clear">
          <span>✓</span>
          <div>
            <strong>平台运行正常</strong>
            <p>当前没有需要人工处理的名单或验证直播间异常。</p>
          </div>
        </section>
      )}
      <div className="overview-grid">
        <section className="panel">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">CREATORS</p>
              <h2>最近更新的主播</h2>
            </div>
            <Link className="text-action" to="/admin/creators">
              管理主播 →
            </Link>
          </div>
          <div className="simple-list">
            {overview.data.recent.map((creator) => (
              <div key={creator.id}>
                <span className="mini-avatar">{creator.displayName.slice(0, 1)}</span>
                <strong>{creator.displayName}</strong>
                <StatusBadge status={creator.active ? 'active' : 'inactive'}>
                  {creator.active ? '已启用' : '已停用'}
                </StatusBadge>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">ROSTER RUNS</p>
              <h2>最近名单任务</h2>
            </div>
            <Link className="text-action" to="/admin/rosters">
              全部任务 →
            </Link>
          </div>
          <div className="simple-list roster">
            {rosters.data.slice(0, 5).map(({ creator, run }) => (
              <div key={run.id}>
                <span>
                  <strong>{creator.displayName}</strong>
                  <small>{formatMonth(run.periodStart)}</small>
                </span>
                <StatusBadge status={run.status}>
                  {run.status === 'FINALIZED'
                    ? '已冻结'
                    : run.status === 'SCHEDULED'
                      ? '已计划'
                      : run.status}
                </StatusBadge>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
