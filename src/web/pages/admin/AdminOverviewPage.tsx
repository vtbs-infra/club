import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  CalendarClock,
  CircleAlert,
  CircleCheck,
  CircleDotDashed,
  RadioTower,
  UsersRound,
  XCircle,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import {
  getAdminCreators,
  getAdminOverview,
  getAdminRosters,
  getVerificationRooms,
} from '../../api/client';
import { ErrorState, LoadingState, MetricCard, PageHeader, StatusBadge } from '../../components/Ui';
import { formatDate, formatMonth } from '../../lib/format';
import {
  activeStatusPresentation,
  roomHealthPresentation,
  snapshotRunPresentation,
} from '../../lib/status-presentation';

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
        eyebrow="平台管理"
        intro="只关注平台级配置、名单异常和验证直播间健康状态。"
        title="平台概览"
      />
      <section className="metric-grid">
        <MetricCard
          description={`${overview.data.activeCreators} 位启用中`}
          icon={UsersRound}
          label="注册主播"
          value={overview.data.creators}
        />
        <MetricCard
          description="迟到抓取需要人工决定"
          icon={CalendarClock}
          label="待确认名单"
          tone={pendingApproval.length > 0 ? 'amber' : 'green'}
          value={pendingApproval.length}
        />
        <MetricCard
          description="等待检查或重试"
          icon={CircleAlert}
          label="同步失败"
          tone={failures.length > 0 ? 'red' : 'green'}
          value={failures.length}
        />
        <MetricCard
          description={`${rooms.data.length} 个房间已配置`}
          icon={RadioTower}
          label="验证直播间异常"
          tone={unhealthyRooms.length > 0 ? 'red' : 'green'}
          value={unhealthyRooms.length}
        />
      </section>
      {pendingApproval.length > 0 ||
      failures.length > 0 ||
      unhealthyRooms.length > 0 ||
      verificationNeedsSetup ? (
        <section className="panel attention-panel">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">待处理事项</p>
              <h2>需要处理</h2>
            </div>
          </div>
          <div className="attention-list">
            {verificationNeedsSetup ? (
              <Link to="/admin/verification">
                <span className="attention-icon warning">
                  <RadioTower aria-hidden="true" size={19} />
                </span>
                <div>
                  <strong>需要配置验证直播间</strong>
                  <p>至少启用一个房间后，普通用户才能绑定 B站 UID。</p>
                </div>
                <b>
                  去配置
                  <ArrowRight aria-hidden="true" size={15} />
                </b>
              </Link>
            ) : null}
            {pendingApproval.map(({ creator, run }) => (
              <Link key={run.id} to={`/admin/rosters?run=${run.id}`}>
                <span className="attention-icon warning">
                  <CircleAlert aria-hidden="true" size={19} />
                </span>
                <div>
                  <strong>
                    {creator.displayName} 的 {formatMonth(run.periodStart)}名单等待确认
                  </strong>
                  <p>抓取开始时间已超过月末准点窗口。</p>
                </div>
                <b>
                  处理
                  <ArrowRight aria-hidden="true" size={15} />
                </b>
              </Link>
            ))}
            {failures.map(({ creator, run }) => (
              <Link key={run.id} to={`/admin/rosters?run=${run.id}`}>
                <span className="attention-icon danger">
                  <XCircle aria-hidden="true" size={19} />
                </span>
                <div>
                  <strong>{creator.displayName} 的名单同步失败</strong>
                  <p>{formatDate(run.scheduledCutoffAt, true)} 计划执行</p>
                </div>
                <b>
                  查看
                  <ArrowRight aria-hidden="true" size={15} />
                </b>
              </Link>
            ))}
            {unhealthyRooms.map((room) => (
              <Link key={room.id} to="/admin/verification">
                <span className="attention-icon warning">
                  <CircleDotDashed aria-hidden="true" size={19} />
                </span>
                <div>
                  <strong>验证直播间“{room.displayName}”未处于健康状态</strong>
                  <p>当前状态：{roomHealthPresentation(room.healthStatus).label}</p>
                </div>
                <b>
                  检查
                  <ArrowRight aria-hidden="true" size={15} />
                </b>
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <section className="all-clear">
          <span>
            <CircleCheck aria-hidden="true" size={22} />
          </span>
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
              <p className="eyebrow">主播账号</p>
              <h2>最近更新的主播</h2>
            </div>
            <Link className="text-action" to="/admin/creators">
              管理主播
              <ArrowRight aria-hidden="true" size={15} />
            </Link>
          </div>
          <div className="simple-list">
            {overview.data.recent.map((creator) => (
              <div key={creator.id}>
                <span className="mini-avatar">{creator.displayName.slice(0, 1)}</span>
                <strong>{creator.displayName}</strong>
                <StatusBadge
                  {...activeStatusPresentation[creator.active ? 'active' : 'inactive']}
                />
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">名单任务</p>
              <h2>最近名单任务</h2>
            </div>
            <Link className="text-action" to="/admin/rosters">
              全部任务
              <ArrowRight aria-hidden="true" size={15} />
            </Link>
          </div>
          <div className="simple-list roster">
            {rosters.data.slice(0, 5).map(({ creator, run }) => (
              <div key={run.id}>
                <span>
                  <strong>{creator.displayName}</strong>
                  <small>{formatMonth(run.periodStart)}</small>
                </span>
                <StatusBadge {...snapshotRunPresentation(run.status)} />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
