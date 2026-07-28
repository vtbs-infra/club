import type { ReactNode } from 'react';

import { ApiError } from '../api/http';

export function PageHeader({
  actions,
  eyebrow,
  intro,
  title,
}: {
  readonly actions?: ReactNode;
  readonly eyebrow?: string;
  readonly intro?: string;
  readonly title: string;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {intro ? <p className="page-intro">{intro}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function LoadingState({ label = '正在加载…' }: { readonly label?: string }) {
  return (
    <div className="state-card" role="status">
      <span className="spinner" />
      <p>{label}</p>
    </div>
  );
}

export function ErrorState({
  error,
  title = '暂时无法加载',
}: {
  readonly error: unknown;
  readonly title?: string;
}) {
  return (
    <div className="state-card state-error" role="alert">
      <strong>{title}</strong>
      <p>{error instanceof ApiError ? error.message : '请稍后重试。'}</p>
    </div>
  );
}

export function EmptyState({
  action,
  description,
  title,
}: {
  readonly action?: ReactNode;
  readonly description: string;
  readonly title: string;
}) {
  return (
    <div className="empty-state">
      <span aria-hidden="true">✦</span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function StatusBadge({
  status,
  children,
}: {
  readonly children: ReactNode;
  readonly status: string;
}) {
  return (
    <span className={`status-badge status-${status.toLowerCase().replaceAll('_', '-')}`}>
      {children}
    </span>
  );
}

export function InlineNotice({
  children,
  tone = 'info',
}: {
  readonly children: ReactNode;
  readonly tone?: 'info' | 'success' | 'warning' | 'danger';
}) {
  return <div className={`inline-notice notice-${tone}`}>{children}</div>;
}
