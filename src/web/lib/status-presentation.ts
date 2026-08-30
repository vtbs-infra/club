import type {
  Announcement,
  BilibiliChallenge,
  GiftOrder,
  GiftRelease,
  SnapshotDetail,
  SnapshotRun,
  SystemStatus,
  VerificationRoom,
} from '../api/client';

export type StatusTone = 'danger' | 'info' | 'neutral' | 'success' | 'warning';

export interface StatusPresentation {
  readonly label: string;
  readonly tone: StatusTone;
}

export const giftOrderPresentation = {
  CANCELLED: { label: '已取消', tone: 'neutral' },
  CLAIMABLE: { label: '待领取', tone: 'info' },
  COMPLETED: { label: '已完成', tone: 'success' },
  EXPIRED: { label: '已过期', tone: 'neutral' },
  SHIPPED: { label: '已发货', tone: 'info' },
  SUBMITTED: { label: '待发货', tone: 'warning' },
} as const satisfies Readonly<Record<GiftOrder['status'], StatusPresentation>>;

export const giftReleasePresentation = {
  CLOSED: { label: '已关闭', tone: 'neutral' },
  DRAFT: { label: '草稿', tone: 'neutral' },
  PUBLISHED: { label: '已发布', tone: 'success' },
} as const satisfies Readonly<Record<GiftRelease['status'], StatusPresentation>>;

const snapshotPresentations = {
  CANCELLED: { label: '已取消', tone: 'neutral' },
  FAILED: { label: '同步失败', tone: 'danger' },
  FINALIZED: { label: '已冻结', tone: 'success' },
  PENDING_APPROVAL: { label: '等待平台确认', tone: 'warning' },
  REJECTED: { label: '已拒绝', tone: 'danger' },
  RUNNING: { label: '同步中', tone: 'info' },
  SCHEDULED: { label: '已计划', tone: 'neutral' },
} as const satisfies Readonly<Record<SnapshotRun['status'], StatusPresentation>>;

export function snapshotRunPresentation(status: string): StatusPresentation {
  return (
    (snapshotPresentations as Readonly<Record<string, StatusPresentation>>)[status] ?? {
      label: '未知状态',
      tone: 'neutral',
    }
  );
}

export const snapshotConsistencyPresentation = {
  CONSISTENT: { label: '一致', tone: 'success' },
  INCONSISTENT: { label: '不一致', tone: 'danger' },
  PENDING: { label: '校验中', tone: 'info' },
} as const satisfies Readonly<
  Record<SnapshotDetail['attempts'][number]['consistencyStatus'], StatusPresentation>
>;

export const announcementSeverityPresentation = {
  CRITICAL: { label: '紧急', tone: 'danger' },
  INFO: { label: '公告', tone: 'info' },
  WARNING: { label: '重要', tone: 'warning' },
} as const satisfies Readonly<Record<Announcement['severity'], StatusPresentation>>;

export const announcementStatePresentation = {
  DRAFT: { label: '草稿', tone: 'neutral' },
  PUBLISHED: { label: '已发布', tone: 'success' },
  WITHDRAWN: { label: '已撤下', tone: 'warning' },
} as const satisfies Readonly<Record<Announcement['status'], StatusPresentation>>;

const shipmentProgressPresentations = {
  DELIVERED: { label: '已送达', tone: 'success' },
  IN_TRANSIT: { label: '运输中', tone: 'info' },
  LABEL_CREATED: { label: '已录单', tone: 'warning' },
  OUT_FOR_DELIVERY: { label: '派送中', tone: 'warning' },
} as const satisfies Readonly<
  Record<GiftOrder['shipments'][number]['progress'], StatusPresentation>
>;

export function shipmentProgressPresentation(progress: string): StatusPresentation {
  return (
    (shipmentProgressPresentations as Readonly<Record<string, StatusPresentation>>)[progress] ?? {
      label: '状态更新中',
      tone: 'neutral',
    }
  );
}

export const shipmentExceptionPresentation = {
  label: '物流异常',
  tone: 'danger',
} as const satisfies StatusPresentation;

const roomHealthPresentations = {
  CONNECTING: { label: '连接中', tone: 'info' },
  HEALTHY: { label: '健康', tone: 'success' },
  UNHEALTHY: { label: '异常', tone: 'danger' },
  UNKNOWN: { label: '等待检测', tone: 'neutral' },
} as const satisfies Readonly<Record<VerificationRoom['healthStatus'], StatusPresentation>>;

export function roomHealthPresentation(status: string, enabled = true): StatusPresentation {
  if (!enabled) return { label: '已停用', tone: 'neutral' };
  return (
    (roomHealthPresentations as Readonly<Record<string, StatusPresentation>>)[status] ?? {
      label: '未知状态',
      tone: 'neutral',
    }
  );
}

export const connectionStatePresentation = {
  CONNECTING: { label: '正在连接直播间', tone: 'info' },
  HEALTHY: { label: '正在监听直播间', tone: 'success' },
  UNHEALTHY: { label: '连接恢复中', tone: 'danger' },
} as const satisfies Readonly<
  Record<NonNullable<BilibiliChallenge['connectionState']>, StatusPresentation>
>;

export const systemStatusPresentation = {
  degraded: { label: '需要检查', tone: 'danger' },
  needs_setup: { label: '需要配置', tone: 'warning' },
  ok: { label: '运行正常', tone: 'success' },
} as const satisfies Readonly<Record<SystemStatus['status'], StatusPresentation>>;

export const runtimeStatePresentation = {
  DEGRADED: { label: '运行异常', tone: 'danger' },
  RUNNING: { label: '运行中', tone: 'success' },
  STARTING: { label: '启动中', tone: 'warning' },
  STOPPED: { label: '已停止', tone: 'danger' },
} as const satisfies Readonly<
  Record<SystemStatus['runtimes']['binding']['state'], StatusPresentation>
>;

export const monthlySyncPresentation = {
  disabled: { label: '同步暂停', tone: 'neutral' },
  enabled: { label: '同步开启', tone: 'success' },
} as const satisfies Readonly<Record<'disabled' | 'enabled', StatusPresentation>>;

export const bindingStatusPresentation = {
  pending: { label: '尚未绑定', tone: 'warning' },
  verified: { label: '已绑定', tone: 'success' },
} as const satisfies Readonly<Record<'pending' | 'verified', StatusPresentation>>;

export function integrityPresentation(ok: boolean): StatusPresentation {
  return ok ? { label: '全部哈希一致', tone: 'success' } : { label: '发现不一致', tone: 'danger' };
}
