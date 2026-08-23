import { useQuery } from '@tanstack/react-query';
import { CalendarSync, CircleCheck, Database, HardDrive, RadioTower, Truck } from 'lucide-react';
import { useState } from 'react';

import { getAdminAuditLogs, getAdminSystem } from '../../api/client';
import { AnnouncementManager } from '../../components/AnnouncementManager';
import { ErrorState, LoadingState, MetricCard, PageHeader, StatusBadge } from '../../components/Ui';
import { formatDate } from '../../lib/format';
import {
  roomHealthPresentation,
  runtimeStatePresentation,
  shipmentPresentation,
  snapshotRunPresentation,
  systemStatusPresentation,
  type StatusTone,
} from '../../lib/status-presentation';

function runtimeMetricTone(tone: StatusTone): 'amber' | 'green' | 'red' {
  if (tone === 'success') return 'green';
  if (tone === 'warning') return 'amber';
  return 'red';
}

const auditActionLabel: Readonly<Record<string, string>> = {
  'address.created': '新增收货地址',
  'address.deleted': '删除收货地址',
  'address.updated': '修改收货地址',
  'creator.created': '注册主播',
  'creator.updated': '修改主播',
  'gift-order.cancelled': '取消礼物单',
  'gift-order.shipped': '礼物单发货',
  'gift-release.fulfillment-exported': '导出待发货清单',
  'gift-release.created': '创建礼物草稿',
  'gift-release.published': '发布礼物',
  'snapshot.approved': '确认迟到名单',
  'snapshot.rejected': '拒绝迟到名单',
  'verification-room.created': '新增验证直播间',
  'verification-room.updated': '修改验证直播间',
};

export function AdminAnnouncementsPage() {
  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="平台公告"
        intro="平台公告默认只对已登录用户可见，也可以为单条公告开启公开首页展示。"
        title="平台公告"
      />
      <AnnouncementManager area="admin" />
    </div>
  );
}

export function AdminSystemPage() {
  const [auditBefore, setAuditBefore] = useState<string | undefined>();
  const system = useQuery({ queryFn: getAdminSystem, queryKey: ['admin', 'system'] });
  const audit = useQuery({
    queryFn: () => getAdminAuditLogs(auditBefore),
    queryKey: ['admin', 'audit', auditBefore],
  });
  if (system.isPending || audit.isPending) return <LoadingState label="正在检查系统…" />;
  if (system.isError || audit.isError) return <ErrorState error={system.error ?? audit.error} />;
  const data = system.data;
  const auditItems = audit.data.items;
  const bindingRuntime = runtimeStatePresentation[data.runtimes.binding.state];
  const rosterRuntime = runtimeStatePresentation[data.runtimes.roster.state];
  const trackingRuntime = runtimeStatePresentation[data.runtimes.tracking.state];
  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="系统状态"
        intro={`Club ${data.version} · 数据库、私有存储和后台任务的运行状态。`}
        title="系统"
        actions={<StatusBadge {...systemStatusPresentation[data.status]} />}
      />
      <section className="metric-grid system-metrics">
        <MetricCard
          description="业务数据与审计记录"
          icon={Database}
          label="PostgreSQL"
          tone={data.checks.database === 'ok' ? 'green' : 'red'}
          value={data.checks.database === 'ok' ? '正常' : '异常'}
        />
        <MetricCard
          description="名单原始分页证据"
          icon={HardDrive}
          label="私有文件存储"
          tone={data.checks.storage === 'ok' ? 'green' : 'red'}
          value={data.checks.storage === 'ok' ? '正常' : '异常'}
        />
        <MetricCard
          description={
            data.runtimes.binding.lastTickAt
              ? `最近 ${formatDate(data.runtimes.binding.lastTickAt, true)}`
              : '尚无执行记录'
          }
          icon={RadioTower}
          label="验证连接"
          tone={runtimeMetricTone(bindingRuntime.tone)}
          value={bindingRuntime.label}
        />
        <MetricCard
          description={
            data.runtimes.roster.lastTickAt
              ? `最近 ${formatDate(data.runtimes.roster.lastTickAt, true)}`
              : '尚无执行记录'
          }
          icon={CalendarSync}
          label="名单调度器"
          tone={runtimeMetricTone(rosterRuntime.tone)}
          value={rosterRuntime.label}
        />
        <MetricCard
          description={`${data.trackingDueCount} 个物流等待刷新`}
          icon={Truck}
          label="物流刷新"
          tone={runtimeMetricTone(trackingRuntime.tone)}
          value={
            !data.runtimes.tracking.configured && data.runtimes.tracking.state === 'RUNNING'
              ? '定时清理运行中'
              : trackingRuntime.label
          }
        />
      </section>
      <div className="overview-grid">
        <section className="panel">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">名单任务</p>
              <h2>名单任务状态</h2>
            </div>
          </div>
          <div className="count-list">
            {Object.keys(data.snapshotRunCounts).length === 0 ? (
              <p className="quiet-line">暂无名单任务。</p>
            ) : (
              Object.entries(data.snapshotRunCounts).map(([status, count]) => (
                <div key={status}>
                  <StatusBadge {...snapshotRunPresentation(status)} />
                  <strong>{count}</strong>
                </div>
              ))
            )}
          </div>
        </section>
        <section className="panel">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">发货概况</p>
              <h2>物流状态</h2>
            </div>
          </div>
          <div className="count-list">
            {Object.keys(data.shipmentCounts).length === 0 ? (
              <p className="quiet-line">暂无物流记录。</p>
            ) : (
              Object.entries(data.shipmentCounts).map(([status, count]) => (
                <div key={status}>
                  <StatusBadge {...shipmentPresentation(status)} />
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
              <p className="eyebrow">验证直播间</p>
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
                  <StatusBadge {...roomHealthPresentation(room.healthStatus, room.enabled)} />
                </div>
              ))
            )}
          </div>
        </section>
        <section className="panel">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">数据完整性</p>
              <h2>证据完整性</h2>
            </div>
          </div>
          {data.integrityWarnings.length === 0 ? (
            <div className="mini-success">
              <span>
                <CircleCheck aria-hidden="true" size={18} />
              </span>
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
            <p className="eyebrow">审计记录</p>
            <h2>最近平台操作</h2>
          </div>
        </div>
        {auditItems.length === 0 ? (
          <p className="quiet-line">暂无审计记录。</p>
        ) : (
          <div className="audit-list">
            {auditItems.map((item) => (
              <details key={item.id}>
                <summary>
                  <time>{formatDate(item.createdAt, true)}</time>
                  <strong>{auditActionLabel[item.action] ?? item.action}</strong>
                  <span>{item.actorName ?? item.actorEmail ?? '系统'}</span>
                </summary>
                <dl className="detail-grid">
                  <div>
                    <dt>目标</dt>
                    <dd>
                      {item.targetType} · {item.targetId}
                    </dd>
                  </div>
                  <div>
                    <dt>请求 ID</dt>
                    <dd>{item.requestId ?? '—'}</dd>
                  </div>
                  {item.reason ? (
                    <div>
                      <dt>原因</dt>
                      <dd>{item.reason}</dd>
                    </div>
                  ) : null}
                </dl>
                {item.beforeSummary || item.afterSummary ? (
                  <pre>
                    {JSON.stringify(
                      { after: item.afterSummary, before: item.beforeSummary },
                      null,
                      2,
                    )}
                  </pre>
                ) : null}
              </details>
            ))}
            <div className="form-actions">
              {auditBefore ? (
                <button
                  className="button ghost"
                  onClick={() => setAuditBefore(undefined)}
                  type="button"
                >
                  返回最新记录
                </button>
              ) : null}
              {audit.data.nextBefore ? (
                <button
                  className="button secondary"
                  disabled={audit.isFetching}
                  onClick={() => setAuditBefore(audit.data.nextBefore ?? undefined)}
                  type="button"
                >
                  {audit.isFetching ? '正在加载…' : '查看更早记录'}
                </button>
              ) : null}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
