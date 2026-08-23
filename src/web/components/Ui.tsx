import * as Dialog from '@radix-ui/react-dialog';
import {
  CircleAlert,
  CircleCheck,
  Inbox,
  Info,
  LoaderCircle,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { useRef, type ReactNode } from 'react';

import { ApiError } from '../api/http';
import { errorMessage } from '../lib/error-message';

function ErrorDetails({ error }: { readonly error: unknown }) {
  if (!(error instanceof ApiError)) return null;
  return (
    <details className="error-details">
      <summary>错误详情</summary>
      <dl>
        <div>
          <dt>错误代码</dt>
          <dd>{error.code}</dd>
        </div>
        {error.requestId ? (
          <div>
            <dt>请求 ID</dt>
            <dd>
              <code>{error.requestId}</code>
              <button
                className="text-button"
                onClick={() => {
                  void navigator.clipboard.writeText(error.requestId!);
                }}
                type="button"
              >
                复制
              </button>
            </dd>
          </div>
        ) : null}
        {error.message ? (
          <div>
            <dt>原始信息（排障用）</dt>
            <dd>{error.message}</dd>
          </div>
        ) : null}
      </dl>
    </details>
  );
}

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

export function MetricCard({
  description,
  icon: Icon,
  label,
  tone = 'blue',
  value,
}: {
  readonly description: string;
  readonly icon: LucideIcon;
  readonly label: string;
  readonly tone?: 'amber' | 'blue' | 'green' | 'red' | 'violet';
  readonly value: ReactNode;
}) {
  return (
    <article className={`metric-card tone-${tone}`}>
      <span className="metric-icon">
        <Icon aria-hidden="true" size={21} />
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <p>{description}</p>
      </div>
    </article>
  );
}

export function LoadingState({ label = '正在加载…' }: { readonly label?: string }) {
  return (
    <div className="state-card" role="status">
      <LoaderCircle aria-hidden="true" className="spinner" />
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
      <CircleAlert aria-hidden="true" className="state-icon" />
      <strong>{title}</strong>
      <p>{errorMessage(error)}</p>
      <ErrorDetails error={error} />
    </div>
  );
}

export function EmptyState({
  action,
  description,
  icon: Icon = Inbox,
  title,
}: {
  readonly action?: ReactNode;
  readonly description: string;
  readonly icon?: LucideIcon;
  readonly title: string;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon" aria-hidden="true">
        <Icon size={25} />
      </span>
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
  const Icon = {
    danger: CircleAlert,
    info: Info,
    success: CircleCheck,
    warning: TriangleAlert,
  }[tone];
  return (
    <div className={`inline-notice notice-${tone}`}>
      <Icon aria-hidden="true" size={18} />
      <div>{children}</div>
    </div>
  );
}

export function ErrorNotice({ error }: { readonly error: unknown }) {
  return (
    <InlineNotice tone="danger">
      <p>{errorMessage(error)}</p>
      <ErrorDetails error={error} />
    </InlineNotice>
  );
}

export function ConfirmDialog({
  busy = false,
  confirmLabel = '确认',
  confirmDisabled = false,
  description,
  onCancel,
  onConfirm,
  open,
  title,
  tone = 'primary',
}: {
  readonly busy?: boolean;
  readonly confirmDisabled?: boolean;
  readonly confirmLabel?: string;
  readonly description: ReactNode;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly open: boolean;
  readonly title: string;
  readonly tone?: 'danger' | 'primary';
}) {
  const returnFocusRef = useRef<HTMLElement | null>(null);

  return (
    <Dialog.Root
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !busy) onCancel();
      }}
      open={open}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-backdrop" />
        <Dialog.Content
          className="confirm-dialog"
          onCloseAutoFocus={(event) => {
            const returnFocus = returnFocusRef.current;
            returnFocusRef.current = null;
            if (!returnFocus?.isConnected) return;
            event.preventDefault();
            returnFocus.focus();
          }}
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
          onOpenAutoFocus={() => {
            returnFocusRef.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onPointerDownOutside={(event) => {
            if (busy) event.preventDefault();
          }}
        >
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description asChild>
            <div className="confirm-dialog-copy">{description}</div>
          </Dialog.Description>
          <div className="form-actions">
            <Dialog.Close asChild>
              <button className="button ghost" disabled={busy} type="button">
                返回
              </button>
            </Dialog.Close>
            <button
              className={tone === 'danger' ? 'button danger' : 'button primary'}
              disabled={busy || confirmDisabled}
              onClick={onConfirm}
              type="button"
            >
              {busy ? '正在处理…' : confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
