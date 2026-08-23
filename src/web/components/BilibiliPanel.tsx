import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, ExternalLink, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  createChallenge,
  getBinding,
  getChallenge,
  unbindBilibili,
  type IssuedBilibiliChallenge,
} from '../api/client';
import { ConfirmDialog, ErrorNotice, InlineNotice, LoadingState } from './Ui';

const pageLoadedAt = Date.now();

function useCountdown(expiresAt?: string): number {
  const [now, setNow] = useState(pageLoadedAt);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  return expiresAt ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1_000)) : 0;
}

function timerLabel(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function BilibiliPanel() {
  const queryClient = useQueryClient();
  const [issued, setIssued] = useState<IssuedBilibiliChallenge | null>(null);
  const [confirmUnbind, setConfirmUnbind] = useState(false);
  const binding = useQuery({
    queryFn: getBinding,
    queryKey: ['me', 'bilibili-binding'],
    refetchInterval: 2_000,
  });
  const challenge = useQuery({
    enabled: binding.data === null,
    queryFn: getChallenge,
    queryKey: ['me', 'bilibili-challenge'],
    refetchInterval: 2_000,
  });
  const create = useMutation({
    mutationFn: createChallenge,
    onSuccess: async (result) => {
      setIssued(result);
      await queryClient.invalidateQueries({ queryKey: ['me', 'bilibili-challenge'] });
    },
  });
  const remove = useMutation({
    mutationFn: unbindBilibili,
    onSuccess: async () => {
      setConfirmUnbind(false);
      setIssued(null);
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      await queryClient.invalidateQueries({ queryKey: ['gifts'] });
    },
  });
  const remaining = useCountdown(issued?.expiresAt ?? challenge.data?.expiresAt);

  if (binding.isPending) return <LoadingState label="正在读取 B站绑定…" />;
  if (binding.data) {
    return (
      <>
        <section className="identity-card verified">
          <div className="identity-icon" aria-hidden="true">
            <CircleCheck size={25} />
          </div>
          <div>
            <p className="eyebrow">已完成 B站身份验证</p>
            <h2>{binding.data.biliDisplayName ?? `UID ${binding.data.biliUid}`}</h2>
            <p>UID {binding.data.biliUid} · 礼物资格会通过这个 UID 自动匹配。</p>
          </div>
          <button
            className="button ghost danger"
            disabled={remove.isPending}
            onClick={() => setConfirmUnbind(true)}
            type="button"
          >
            解除绑定
          </button>
        </section>
        {remove.isError ? <ErrorNotice error={remove.error} /> : null}
        <ConfirmDialog
          busy={remove.isPending}
          confirmLabel="解除绑定"
          description="解绑后，尚未领取的礼物会暂时隐藏；已经提交的礼物单和冻结资料不受影响。"
          onCancel={() => setConfirmUnbind(false)}
          onConfirm={() => remove.mutate()}
          open={confirmUnbind}
          title="确认解除 B站绑定？"
          tone="danger"
        />
      </>
    );
  }

  const current = challenge.data;
  const active = current?.status === 'ACTIVE' && remaining > 0;
  return (
    <section className="binding-flow">
      <div className="section-heading">
        <div>
          <p className="eyebrow">B站身份验证</p>
          <h2>在指定直播间发送一次性验证码</h2>
          <p>平台会自动选择验证直播间。无需输入 UID，也不会要求 B站密码。</p>
        </div>
      </div>
      {active && issued ? (
        <div className="code-card">
          <div className="code-card-status">
            <span className={`connection-dot state-${current.connectionState?.toLowerCase()}`} />
            <span>
              {current.connectionState === 'HEALTHY'
                ? '正在监听直播间'
                : current.connectionState === 'CONNECTING'
                  ? '正在连接直播间'
                  : '连接恢复中'}
            </span>
            <strong>{timerLabel(remaining)}</strong>
          </div>
          <code>{issued.code}</code>
          <ol>
            <li>点击下方按钮前往验证直播间</li>
            <li>把上方验证码作为普通弹幕完整发送一次</li>
            <li>保留此页面，验证成功后会自动更新</li>
          </ol>
          <a className="button primary" href={issued.room.link} rel="noreferrer" target="_blank">
            前往 {issued.room.displayName}
            <ExternalLink aria-hidden="true" size={16} />
          </a>
        </div>
      ) : (
        <div className="start-binding">
          {current?.status === 'CONFLICT' ? (
            <InlineNotice tone="danger">
              这个 B站 UID 已绑定其他账号，请联系平台管理员处理。
            </InlineNotice>
          ) : null}
          {active && !issued ? (
            <InlineNotice tone="warning">
              出于安全考虑，旧验证码不会再次显示。请生成一个新验证码继续。
            </InlineNotice>
          ) : null}
          <button
            className="button primary"
            disabled={create.isPending}
            onClick={() => create.mutate()}
            type="button"
          >
            {create.isPending ? '正在准备验证…' : active ? '生成新验证码' : '开始验证'}
            {!create.isPending ? <ShieldCheck aria-hidden="true" size={16} /> : null}
          </button>
          {create.isError ? <ErrorNotice error={create.error} /> : null}
        </div>
      )}
    </section>
  );
}
