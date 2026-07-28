import { useQuery } from '@tanstack/react-query';

import { getAdminAuditLogs, getAdminSystem } from '../../api/client';
import { AnnouncementManager } from '../../components/AnnouncementManager';
import { ErrorState, LoadingState, PageHeader, StatusBadge } from '../../components/Ui';
import { formatDate } from '../../lib/format';

interface SystemStatus {
  readonly checks: { readonly database: string; readonly storage: string };
  readonly integrityWarnings: readonly {
    readonly creatorId: string;
    readonly pageId: string;
    readonly runId: string;
  }[];
  readonly recentSnapshotFailures: readonly {
    readonly createdAt: string;
    readonly failureCode: null | string;
    readonly runId: string;
  }[];
  readonly rooms: readonly {
    readonly displayName: string;
    readonly enabled: boolean;
    readonly healthStatus: string;
    readonly lastConnectedAt: null | string;
  }[];
  readonly schedulers: {
    readonly roster: { readonly lastTickAt: null | string; readonly running: boolean };
    readonly tracking: {
      readonly configured: boolean;
      readonly lastTickAt: null | string;
      readonly running: boolean;
    };
  };
  readonly shipmentCounts: Readonly<Record<string, number>>;
  readonly snapshotRunCounts: Readonly<Record<string, number>>;
  readonly status: 'degraded' | 'ok';
  readonly trackingDueCount: number;
  readonly version: string;
}

export function AdminAnnouncementsPage() {
  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="PLATFORM ANNOUNCEMENTS"
        intro="平台公告对所有已登录用户可见。"
        title="平台公告"
      />
      <AnnouncementManager area="admin" />
    </div>
  );
}

export function AdminSystemPage() {
  const system = useQuery({ queryFn: getAdminSystem, queryKey: ['admin', 'system'] });
  const audit = useQuery({ queryFn: getAdminAuditLogs, queryKey: ['admin', 'audit'] });
  if (system.isPending || audit.isPending) return <LoadingState label="正在检查系统…" />;
  if (system.isError || audit.isError) return <ErrorState error={system.error ?? audit.error} />;
  const data = system.data as unknown as SystemStatus;
  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="SYSTEM"
        intro={`Club ${data.version} · 数据库、私有存储和后台任务的运行状态。`}
        title="系统"
        actions={
          <StatusBadge status={data.status}>
            {data.status === 'ok' ? '运行正常' : '需要检查'}
          </StatusBadge>
        }
      />
      <section className="metric-grid system-metrics">
        <article>
          <span className="metric-icon">DB</span>
          <div>
            <small>PostgreSQL</small>
            <strong>{data.checks.database === 'ok' ? '正常' : '异常'}</strong>
            <p>业务数据与审计记录</p>
          </div>
        </article>
        <article>
          <span className="metric-icon">FS</span>
          <div>
            <small>私有文件存储</small>
            <strong>{data.checks.storage === 'ok' ? '正常' : '异常'}</strong>
            <p>名单原始分页证据</p>
          </div>
        </article>
        <article>
          <span className="metric-icon">月</span>
          <div>
            <small>名单调度器</small>
            <strong>{data.schedulers.roster.running ? '运行中' : '已停止'}</strong>
            <p>
              {data.schedulers.roster.lastTickAt
                ? `最近 ${formatDate(data.schedulers.roster.lastTickAt, true)}`
                : '尚无执行记录'}
            </p>
          </div>
        </article>
        <article>
          <span className="metric-icon">运</span>
          <div>
            <small>物流刷新</small>
            <strong>
              {data.schedulers.tracking.configured
                ? data.schedulers.tracking.running
                  ? '运行中'
                  : '已停止'
                : '未配置'}
            </strong>
            <p>{data.trackingDueCount} 个物流等待刷新</p>
          </div>
        </article>
      </section>
      <div className="overview-grid">
        <section className="panel">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">ROSTER RUNS</p>
              <h2>名单任务状态</h2>
            </div>
          </div>
          <div className="count-list">
            {Object.keys(data.snapshotRunCounts).length === 0 ? (
              <p className="quiet-line">暂无名单任务。</p>
            ) : (
              Object.entries(data.snapshotRunCounts).map(([status, count]) => (
                <div key={status}>
                  <StatusBadge status={status}>{status}</StatusBadge>
                  <strong>{count}</strong>
                </div>
              ))
            )}
          </div>
        </section>
        <section className="panel">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">SHIPMENTS</p>
              <h2>物流状态</h2>
            </div>
          </div>
          <div className="count-list">
            {Object.keys(data.shipmentCounts).length === 0 ? (
              <p className="quiet-line">暂无物流记录。</p>
            ) : (
              Object.entries(data.shipmentCounts).map(([status, count]) => (
                <div key={status}>
                  <StatusBadge status={status}>{status}</StatusBadge>
                  <strong>{count}</strong>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
      <div className="overview-grid">
        <section className="panel">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">VERIFICATION ROOMS</p>
              <h2>验证直播间</h2>
            </div>
          </div>
          <div className="simple-list roster">
            {data.rooms.length === 0 ? (
              <p className="quiet-line">尚未配置验证直播间。</p>
            ) : (
              data.rooms.map((room) => (
                <div key={room.displayName}>
                  <span>
                    <strong>{room.displayName}</strong>
                    <small>
                      {room.lastConnectedAt
                        ? `最近连接 ${formatDate(room.lastConnectedAt, true)}`
                        : '尚未连接'}
                    </small>
                  </span>
                  <StatusBadge status={room.enabled ? room.healthStatus : 'disabled'}>
                    {room.enabled ? room.healthStatus : 'DISABLED'}
                  </StatusBadge>
                </div>
              ))
            )}
          </div>
        </section>
        <section className="panel">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">INTEGRITY</p>
              <h2>证据完整性</h2>
            </div>
          </div>
          {data.integrityWarnings.length === 0 ? (
            <div className="mini-success">
              <span>✓</span>
              <p>最近检查的名单分页文件均可访问。</p>
            </div>
          ) : (
            <div className="warning-list">
              {data.integrityWarnings.map((warning) => (
                <p key={warning.pageId}>
                  名单任务 {warning.runId.slice(0, 8)} 的一页证据文件缺失。
                </p>
              ))}
            </div>
          )}
        </section>
      </div>
      <section className="panel">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">AUDIT LOG</p>
            <h2>最近平台操作</h2>
          </div>
        </div>
        {audit.data.items.length === 0 ? (
          <p className="quiet-line">暂无审计记录。</p>
        ) : (
          <div className="audit-list">
            {audit.data.items.map((item) => (
              <div key={item.id}>
                <time>{formatDate(item.createdAt, true)}</time>
                <strong>{item.action}</strong>
                <span>{item.targetType}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
