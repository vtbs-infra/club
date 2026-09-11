import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';
import type {
  BilibiliAccount,
  BilibiliLoginState,
  BilibiliSessionStatus,
} from '../../../shared/contracts/bilibili';
import {
  activateBilibiliLogin,
  cancelBilibiliLogin,
  checkBilibiliSession,
  createBilibiliLogin,
  disconnectBilibiliSession,
  getBilibiliLogin,
  getBilibiliSession,
} from '../../api/bilibili';
import { ApiError } from '../../api/http';
import {
  ConfirmDialog,
  ErrorNotice,
  ErrorState,
  InlineNotice,
  LoadingState,
  StatusBadge,
} from '../../components/Ui';
import { errorMessage } from '../../lib/error-message';
import { formatDate } from '../../lib/format';
import type { StatusTone } from '../../lib/status-presentation';

const sessionKey = ['admin', 'bilibili'] as const;
const loginKey = (id: string | null) => ['admin', 'bilibili-login', id] as const;
const pendingStates: BilibiliLoginState[] = [
  'CREATING',
  'WAITING',
  'VERIFYING',
  'READY',
  'ACTIVATING',
];
const validity: Record<BilibiliSessionStatus['validity'], { label: string; tone: StatusTone }> = {
  NOT_CONFIGURED: { label: '尚未配置', tone: 'neutral' },
  CHECKING: { label: '正在核验', tone: 'warning' },
  VALID: { label: '登录有效', tone: 'success' },
  REAUTH_REQUIRED: { label: '需要重新扫码', tone: 'danger' },
};
const loginLabels: Record<BilibiliLoginState, string> = {
  CREATING: '正在申请二维码…',
  WAITING: '等待扫码或手机确认',
  VERIFYING: '正在核对账号…',
  READY: '请确认启用的账号',
  ACTIVATING: '正在启用账号…',
  APPLIED: '账号已启用',
  CANCELLED: '本次扫码已取消',
  EXPIRED: '二维码或候选账号已过期',
  FAILED: '本次登录未完成',
};
const dateLabel = (date: string | null) => (date ? formatDate(date, true) : '暂无');
function Account({ account }: { readonly account: BilibiliAccount }) {
  return (
    <div className="bilibili-account">
      <img src={account.avatar} alt="" referrerPolicy="no-referrer" />
      <div>
        <strong>{account.name}</strong>
        <p>UID {account.uid}</p>
      </div>
    </div>
  );
}

export function BilibiliReadingAccount() {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: sessionKey,
    queryFn: getBilibiliSession,
    refetchInterval: 5000,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [disconnectRevision, setDisconnectRevision] = useState<number | null>(null);
  const id = selectedId ?? status.data?.loginAttempt?.id ?? null;
  const login = useQuery({
    queryKey: loginKey(id),
    queryFn: () => getBilibiliLogin(id!),
    enabled: id !== null,
    refetchInterval: (query) =>
      !query.state.data || pendingStates.includes(query.state.data.state) ? 2000 : false,
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: sessionKey }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'verification'] }),
    ]);
  };
  const publish = async (value: BilibiliSessionStatus) => {
    queryClient.setQueryData(sessionKey, value);
    await refresh();
  };
  const create = useMutation({
    mutationFn: createBilibiliLogin,
    onSuccess: async (attempt) => {
      queryClient.setQueryData(loginKey(attempt.id), attempt);
      setSelectedId(attempt.id);
      setShowLogin(true);
      await refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: cancelBilibiliLogin,
    onSuccess: async () => {
      setSelectedId(null);
      setShowLogin(false);
      await refresh();
    },
  });
  const activate = useMutation({
    mutationFn: activateBilibiliLogin,
    onSuccess: async (value) => {
      setShowLogin(false);
      setSelectedId(null);
      await publish(value);
    },
    onError: async () => {
      await refresh();
      if (id) await queryClient.invalidateQueries({ queryKey: loginKey(id) });
    },
  });
  const check = useMutation({ mutationFn: checkBilibiliSession, onSuccess: publish });
  const disconnect = useMutation({
    mutationFn: disconnectBilibiliSession,
    onSuccess: async (value) => {
      setDisconnectRevision(null);
      setSelectedId(null);
      setShowLogin(false);
      await publish(value);
    },
    onError: refresh,
  });
  const busy = create.isPending || cancel.isPending || activate.isPending;
  const closeLogin = () => {
    if (busy) return;
    if (id) cancel.mutate(id);
    else {
      setShowLogin(false);
      setSelectedId(null);
    }
  };
  const error = create.error ?? check.error ?? disconnect.error;
  return (
    <section className="panel stack-lg" aria-labelledby="bilibili-reader-title">
      <div className="section-heading compact">
        <div>
          <h2 id="bilibili-reader-title">B站读取账号</h2>
          <p>用于接收身份验证弹幕、读取主播资料和舰长名单。</p>
        </div>
        {status.data ? <StatusBadge {...validity[status.data.validity]} /> : null}
      </div>
      {status.isPending ? (
        <LoadingState label="正在读取账号状态…" />
      ) : status.isError ? (
        <ErrorState error={status.error} onRetry={() => void status.refetch()} />
      ) : (
        <>
          {status.data.account ? (
            <Account account={status.data.account} />
          ) : (
            <p>请扫码配置一个 B站读取账号，启用后验证直播间会自动连接。</p>
          )}
          <dl className="bilibili-session-details">
            <div>
              <dt>B站连接</dt>
              <dd>
                {
                  { UNKNOWN: '尚未检查', HEALTHY: '可达', UNAVAILABLE: '暂时不可达' }[
                    status.data.reachability
                  ]
                }
              </dd>
            </div>
            <div>
              <dt>当前操作</dt>
              <dd>
                {status.data.operation
                  ? { CHECKING: '检查登录状态', REFRESHING: '续期中', VERIFYING: '核验续期结果' }[
                      status.data.operation
                    ]
                  : '无'}
              </dd>
            </div>
            <div>
              <dt>最近检查</dt>
              <dd>{dateLabel(status.data.checkedAt)}</dd>
            </div>
            <div>
              <dt>最近续期</dt>
              <dd>{dateLabel(status.data.refreshedAt)}</dd>
            </div>
            <div>
              <dt>下次检查或重试</dt>
              <dd>{dateLabel(status.data.nextCheckAt)}</dd>
            </div>
          </dl>
          {status.data.errorCode ? (
            <InlineNotice tone="warning">
              {errorMessage(new ApiError('', 503, status.data.errorCode))}
            </InlineNotice>
          ) : null}
          <div className="form-actions">
            <button
              className="button primary"
              type="button"
              disabled={busy}
              onClick={() => {
                activate.reset();
                cancel.reset();
                create.reset();
                if (status.data.loginAttempt) {
                  setSelectedId(status.data.loginAttempt.id);
                  setShowLogin(true);
                } else create.mutate();
              }}
            >
              {create.isPending
                ? '正在申请…'
                : status.data.loginAttempt
                  ? '继续扫码登录'
                  : status.data.account
                    ? '重新扫码 / 更换账号'
                    : '扫码登录 B站'}
            </button>
            {status.data.account ? (
              <>
                <button
                  className="button secondary"
                  type="button"
                  disabled={
                    check.isPending ||
                    status.data.operation !== null ||
                    status.data.validity === 'REAUTH_REQUIRED'
                  }
                  onClick={() => check.mutate()}
                >
                  检查登录状态
                </button>
                <button
                  className="button ghost"
                  type="button"
                  onClick={() => setDisconnectRevision(status.data.revision)}
                >
                  断开连接
                </button>
              </>
            ) : null}
          </div>
        </>
      )}
      {error ? <ErrorNotice error={error} /> : null}
      <Dialog.Root
        open={showLogin}
        onOpenChange={(open) => {
          if (!open) closeLogin();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-backdrop" />
          <Dialog.Content
            className="confirm-dialog bilibili-login-dialog"
            onPointerDownOutside={(event) => event.preventDefault()}
            onEscapeKeyDown={(event) => {
              if (busy) event.preventDefault();
            }}
          >
            <Dialog.Title>B站读取账号登录</Dialog.Title>
            <Dialog.Description>
              请用准备作为读取账号的 B站账号扫码，并在手机上确认。
            </Dialog.Description>
            {login.isPending ? (
              <LoadingState label="正在读取扫码进度…" />
            ) : (
              <>
                {login.data ? (
                  <div className="stack-lg">
                    <p role="status">{loginLabels[login.data.state]}</p>
                    {login.data.qrUrl ? (
                      <div className="bilibili-qr">
                        <QRCodeSVG
                          value={login.data.qrUrl}
                          size={224}
                          marginSize={4}
                          title="B站登录二维码"
                        />
                      </div>
                    ) : null}
                    {login.data.account ? <Account account={login.data.account} /> : null}
                    {['WAITING', 'READY'].includes(login.data.state) ? (
                      <p>有效至 {formatDate(login.data.expiresAt, true)}</p>
                    ) : null}
                    {login.data.errorCode ? (
                      <InlineNotice tone="warning">
                        {errorMessage(new ApiError('', 503, login.data.errorCode))}
                      </InlineNotice>
                    ) : null}
                  </div>
                ) : null}
                {login.isError ? <ErrorNotice error={login.error} /> : null}
              </>
            )}
            {activate.error || cancel.error ? (
              <ErrorNotice error={activate.error ?? cancel.error} />
            ) : null}
            <div className="form-actions">
              <button className="button ghost" type="button" disabled={busy} onClick={closeLogin}>
                关闭并取消
              </button>
              {login.data?.state === 'READY' ? (
                <button
                  className="button primary"
                  type="button"
                  disabled={busy}
                  onClick={() => activate.mutate(id!)}
                >
                  {activate.isPending ? '正在启用…' : '启用此账号'}
                </button>
              ) : null}
              {login.data && ['EXPIRED', 'FAILED', 'CANCELLED'].includes(login.data.state) ? (
                <button
                  className="button primary"
                  type="button"
                  disabled={busy}
                  onClick={() => create.mutate()}
                >
                  重新申请二维码
                </button>
              ) : null}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <ConfirmDialog
        open={disconnectRevision !== null}
        title="断开 B站读取账号？"
        tone="danger"
        confirmLabel="断开连接"
        description="Club 将停止使用此账号，注册、找回账号和 B站数据读取会暂停，直到重新扫码启用账号。"
        busy={disconnect.isPending}
        onCancel={() => setDisconnectRevision(null)}
        onConfirm={() => {
          if (disconnectRevision !== null) disconnect.mutate(disconnectRevision);
        }}
      />
    </section>
  );
}
