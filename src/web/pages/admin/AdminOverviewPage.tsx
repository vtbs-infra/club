import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  CalendarClock,
  CircleAlert,
  CircleCheck,
  CircleDotDashed,
  Link2,
  RadioTower,
  UsersRound,
  XCircle,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import {
  getAdminBindingConflicts,
  getAdminOverview,
  getAdminRosters,
  getVerificationRooms,
} from '../../api/client';
import { ErrorState, LoadingState, MetricCard, PageHeader, StatusBadge } from '../../components/Ui';
import { formatDate, formatMonth } from '../../lib/format';
import {
  monthlySyncPresentation,
  roomHealthPresentation,
  snapshotRunPresentation,
} from '../../lib/status-presentation';

export function AdminOverviewPage() {
  const overview = useQuery({ queryFn: getAdminOverview, queryKey: ['admin', 'overview'] });
  const bindingConflicts = useQuery({
    queryFn: () => getAdminBindingConflicts(),
    queryKey: ['admin', 'binding-conflicts', undefined],
  });
  const rosters = useQuery({
    queryFn: () => getAdminRosters({ limit: 5 }),
    queryKey: ['admin', 'rosters', 'recent'],
  });
  const rooms = useQuery({ queryFn: getVerificationRooms, queryKey: ['admin', 'verification'] });
  const rosterItems = rosters.data?.items ?? [];
  const pendingApproval = rosterItems.filter(({ run }) => run.status === 'PENDING_APPROVAL');
  const failures = rosterItems.filter(({ run }) => run.status === 'FAILED');
  const pendingApprovalCount = overview.data?.rosterAttention.pendingApproval ?? 0;
  const failureCount = overview.data?.rosterAttention.failed ?? 0;
  const hiddenRosterAttentionCount =
    Math.max(0, pendingApprovalCount - pendingApproval.length) +
    Math.max(0, failureCount - failures.length);
  const unhealthyRooms = (rooms.data ?? []).filter(
    (room) => room.enabled && room.healthStatus !== 'HEALTHY',
  );
  const verificationNeedsSetup = rooms.data ? !rooms.data.some((room) => room.enabled) : false;
  const attentionUnresolved =
    overview.isPending ||
    rosters.isPending ||
    rooms.isPending ||
    bindingConflicts.isPending ||
    overview.isError ||
    rosters.isError ||
    rooms.isError ||
    bindingConflicts.isError;
  const hasAttention =
    (bindingConflicts.data?.items.length ?? 0) > 0 ||
    pendingApprovalCount > 0 ||
    failureCount > 0 ||
    unhealthyRooms.length > 0 ||
    verificationNeedsSetup;
  return (
    <div className="stack-xl">
      <PageHeader
        eyebrow="平台管理"
        intro="只关注平台级配置、绑定冲突、名单异常和验证直播间健康状态。"
        title="平台概览"
      />
      <section className="metric-grid">
        <MetricCard
          description={
            overview.isPending
              ? '正在读取主播数据'
              : overview.isError
                ? '主播数据暂时不可用'
                : `${overview.data.monthlySyncCreators} 位参与同步`
          }
          icon={UsersRound}
          label="注册主播"
          tone={overview.isError ? 'red' : 'blue'}
          value={overview.data?.creators ?? '—'}
        />
        <MetricCard
          description={
            overview.isPending
              ? '正在读取名单数据'
              : overview.isError
                ? '名单数据暂时不可用'
                : pendingApprovalCount > 0
                  ? '迟到抓取需要人工决定'
                  : '当前没有待确认名单'
          }
          icon={
            overview.isPending
              ? CircleDotDashed
              : overview.isError
                ? CircleAlert
                : pendingApprovalCount > 0
                  ? CalendarClock
                  : CircleCheck
          }
          label="待确认名单"
          tone={
            overview.isPending
              ? 'blue'
              : overview.isError
                ? 'red'
                : pendingApprovalCount > 0
                  ? 'amber'
                  : 'green'
          }
          value={overview.data ? pendingApprovalCount : '—'}
        />
        <MetricCard
          description={
            overview.isPending
              ? '正在读取名单数据'
              : overview.isError
                ? '名单数据暂时不可用'
                : failureCount > 0
                  ? '等待检查或重试'
                  : '当前没有失败任务'
          }
          icon={
            overview.isPending
              ? CircleDotDashed
              : overview.isError || failureCount > 0
                ? CircleAlert
                : CircleCheck
          }
          label="失败任务"
          tone={
            overview.isPending ? 'blue' : overview.isError || failureCount > 0 ? 'red' : 'green'
          }
          value={overview.data ? failureCount : '—'}
        />
        <MetricCard
          description={
            rooms.isPending
              ? '正在读取直播间数据'
              : rooms.isError
                ? '直播间数据暂时不可用'
                : verificationNeedsSetup
                  ? '尚未启用可用房间'
                  : unhealthyRooms.length > 0
                    ? `${unhealthyRooms.length} 个启用房间需要检查`
                    : '启用中的房间均正常'
          }
          icon={RadioTower}
          label="验证直播间"
          tone={
            rooms.isPending
              ? 'blue'
              : rooms.isError || unhealthyRooms.length > 0
                ? 'red'
                : verificationNeedsSetup
                  ? 'amber'
                  : 'green'
          }
          value={rooms.data ? rooms.data.length : '—'}
        />
      </section>
      {attentionUnresolved || hasAttention ? (
        <section className="panel attention-panel">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">待处理事项</p>
              <h2>需要处理</h2>
            </div>
          </div>
          {overview.isPending ? (
            <p className="quiet-line" role="status">
              正在汇总名单待办…
            </p>
          ) : null}
          {overview.isError ? (
            <ErrorState
              error={overview.error}
              onRetry={() => void overview.refetch()}
              retryLabel="重试名单汇总"
              title="名单待办汇总暂时无法加载"
            />
          ) : null}
          {rosters.isPending ? (
            <p className="quiet-line" role="status">
              正在读取名单待办…
            </p>
          ) : null}
          {rosters.isError ? (
            <ErrorState
              error={rosters.error}
              onRetry={() => void rosters.refetch()}
              retryLabel="重试名单数据"
              title="名单待办暂时无法加载"
            />
          ) : null}
          {rooms.isPending ? (
            <p className="quiet-line" role="status">
              正在读取直播间状态…
            </p>
          ) : null}
          {rooms.isError ? (
            <ErrorState
              error={rooms.error}
              onRetry={() => void rooms.refetch()}
              retryLabel="重试直播间数据"
              title="直播间状态暂时无法加载"
            />
          ) : null}
          {bindingConflicts.isPending ? (
            <p className="quiet-line" role="status">
              正在读取绑定冲突…
            </p>
          ) : null}
          {bindingConflicts.isError ? (
            <ErrorState
              error={bindingConflicts.error}
              onRetry={() => void bindingConflicts.refetch()}
              retryLabel="重试绑定冲突"
              title="绑定冲突暂时无法加载"
            />
          ) : null}
          <div className="attention-list">
            {bindingConflicts.data && bindingConflicts.data.items.length > 0 ? (
              <Link to="/admin/verification">
                <span className="attention-icon warning">
                  <Link2 aria-hidden="true" size={19} />
                </span>
                <div>
                  <strong>
                    {bindingConflicts.data.nextCursor ? '至少 ' : ''}
                    {bindingConflicts.data.items.length} 项 UID 绑定冲突待处理
                  </strong>
                  <p>核对申请账号与冲突发生时的原绑定。</p>
                </div>
                <b>
                  去处理
                  <ArrowRight aria-hidden="true" size={15} />
                </b>
              </Link>
            ) : null}
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
            {hiddenRosterAttentionCount > 0 ? (
              <Link to="/admin/rosters">
                <span className="attention-icon warning">
                  <CalendarClock aria-hidden="true" size={19} />
                </span>
                <div>
                  <strong>另有 {hiddenRosterAttentionCount} 项名单任务需要处理</strong>
                  <p>最近任务列表未完整展示全部待确认或失败任务。</p>
                </div>
                <b>
                  全部任务
                  <ArrowRight aria-hidden="true" size={15} />
                </b>
              </Link>
            ) : null}
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
          {overview.isPending ? (
            <LoadingState label="正在读取主播…" />
          ) : overview.isError ? (
            <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
          ) : overview.data.recent.length === 0 ? (
            <p className="quiet-line">暂无主播。</p>
          ) : (
            <div className="simple-list">
              {overview.data.recent.map((creator) => (
                <div key={creator.id}>
                  <span className="mini-avatar">{creator.displayName.slice(0, 1)}</span>
                  <strong>{creator.displayName}</strong>
                  <StatusBadge
                    {...monthlySyncPresentation[
                      creator.monthlySyncEnabled ? 'enabled' : 'disabled'
                    ]}
                  />
                </div>
              ))}
            </div>
          )}
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
          {rosters.isPending ? (
            <LoadingState label="正在读取名单任务…" />
          ) : rosters.isError ? (
            <ErrorState error={rosters.error} onRetry={() => void rosters.refetch()} />
          ) : rosterItems.length === 0 ? (
            <p className="quiet-line">暂无名单任务。</p>
          ) : (
            <div className="simple-list roster">
              {rosterItems.map(({ creator, run }) => (
                <div key={run.id}>
                  <span>
                    <strong>{creator.displayName}</strong>
                    <small>{formatMonth(run.periodStart)}</small>
                  </span>
                  <StatusBadge {...snapshotRunPresentation(run.status)} />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
