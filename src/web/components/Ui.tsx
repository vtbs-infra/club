import * as Dialog from '@radix-ui/react-dialog';
import { useRef, type ReactNode } from 'react';

import { ApiError } from '../api/http';

const errorMessages: Readonly<Record<string, string>> = {
  ADDRESS_NOT_FOUND: '这个收货地址已不存在，请刷新后重新选择。',
  GIFT_ORDER_BINDING_REQUIRED: '当前 B站账号绑定与礼物资格不一致，请先重新完成绑定。',
  GIFT_ORDER_NOT_CLAIMABLE: '这份礼物当前不能领取，请刷新页面查看最新状态。',
  GIFT_ORDER_VERSION_CONFLICT: '礼物单状态已经变化，请刷新后再试。',
  GIFT_RELEASE_MONTH_CONFLICT: '这个资格月份已经存在一份礼物发布。',
  GIFT_RELEASE_NOT_FOUND: '这份礼物发布不存在，或不属于当前主播。',
  GIFT_RELEASE_VERSION_CONFLICT: '礼物草稿已在其他页面被修改，请刷新后再试。',
  FULFILLMENT_EXPORT_EMPTY: '这份礼物目前没有待发货的礼物单。',
  REQUEST_FAILED: '操作未能完成，请稍后重试。',
  TRACKING_REFRESH_FAILED: '物流服务暂时不可用，请稍后重试。',
};

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
            <dt>服务端信息</dt>
            <dd>{error.message}</dd>
          </div>
        ) : null}
      </dl>
    </details>
  );
}

function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return '操作未能完成，请稍后重试。';
  return errorMessages[error.code] ?? '操作未能完成，请根据错误详情联系平台管理员。';
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
      <p>{errorMessage(error)}</p>
      <ErrorDetails error={error} />
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
