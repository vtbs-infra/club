import type { GuardTier } from '../api/client';

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

export function relativeDeadline(value: string, now = Date.now()): string {
  const deadline = new Date(value);
  const milliseconds = deadline.getTime() - now;
  if (milliseconds < 0) return '领取期已结束';
  const current = new Date(now);
  const deadlineDay = Date.UTC(deadline.getFullYear(), deadline.getMonth(), deadline.getDate());
  const currentDay = Date.UTC(current.getFullYear(), current.getMonth(), current.getDate());
  const days = Math.round((deadlineDay - currentDay) / 86_400_000);
  if (days === 0) return '今天截止';
  if (days === 1) return '明天截止';
  if (days <= 7) return `${days} 天后截止`;
  return `${formatDate(value)} 截止`;
}
