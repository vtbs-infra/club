import type { GiftOrderStatus, GuardTier } from '../api/client';

export const orderStatusLabel: Readonly<Record<GiftOrderStatus, string>> = {
  CANCELLED: '已取消',
  CLAIMABLE: '待领取',
  COMPLETED: '已完成',
  EXPIRED: '已过期',
  PROCESSING: '处理中',
  SHIPPED: '已发货',
  SUBMITTED: '已提交',
};

export const tierLabel: Readonly<Record<GuardTier, string>> = {
  ADMIRAL: '提督',
  CAPTAIN: '舰长',
  GOVERNOR: '总督',
};

export function formatDate(value: string | Date, withTime = false): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('zh-CN', {
    day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatMonth(value: string): string {
  const [year, month] = value.split('-');
  return `${year} 年 ${Number(month)} 月`;
}

export function relativeDeadline(value: string): string {
  const milliseconds = new Date(value).getTime() - Date.now();
  const days = Math.ceil(milliseconds / 86_400_000);
  if (days < 0) return '领取期已结束';
  if (days === 0) return '今天截止';
  if (days === 1) return '明天截止';
  if (days <= 7) return `${days} 天后截止`;
  return `${formatDate(value)} 截止`;
}
