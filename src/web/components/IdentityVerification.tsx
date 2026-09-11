import {
  Check,
  CircleCheck,
  Clock3,
  Copy,
  ExternalLink,
  LoaderCircle,
  MessageSquare,
  RefreshCw,
} from 'lucide-react';
import { useRef, useState } from 'react';
import type { IdentityChallenge } from '../api/auth';
import { InlineNotice } from './Ui';

function VerificationCode({ code }: { readonly code: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');

  async function copyCode() {
    setCopyState('copying');
    try {
      await navigator.clipboard.writeText(code);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
      input.current?.focus();
      input.current?.select();
    }
  }

  return (
    <div className="identity-code-control">
      <div className="identity-code-row">
        <input
          ref={input}
          aria-label="验证码"
          autoComplete="off"
          className="identity-code"
          readOnly
          spellCheck={false}
          value={code}
          onFocus={(event) => event.currentTarget.select()}
        />
        <button
          aria-label="复制验证码"
          className="button secondary"
          disabled={copyState === 'copying'}
          onClick={() => void copyCode()}
          type="button"
        >
          {copyState === 'copied' ? (
            <Check aria-hidden="true" size={17} />
          ) : (
            <Copy aria-hidden="true" size={17} />
          )}
          {copyState === 'copied' ? '已复制' : '复制'}
        </button>
      </div>
      <p
        className={`identity-copy-feedback${copyState === 'failed' ? ' is-error' : ''}`}
        role="status"
      >
        {copyState === 'failed'
          ? '未能自动复制，已选中验证码，请手动复制。'
          : copyState === 'copied'
            ? '验证码已复制，去直播间粘贴发送即可。'
            : '请完整发送验证码，包括 CLUB- 前缀。'}
      </p>
    </div>
  );
}

export function IdentityVerification({
  challenge,
  code,
  now,
  busy,
  recoveryUid,
  onRestart,
  onChangeIdentity,
}: {
  readonly challenge: IdentityChallenge;
  readonly code: string | undefined;
  readonly now: number;
  readonly busy: boolean;
  readonly recoveryUid: string | null;
  readonly onRestart: () => void;
  readonly onChangeIdentity: () => void;
}) {
  const remaining = Math.max(0, Math.ceil((Date.parse(challenge.expiresAt) - now) / 1000));
  const expired =
    remaining === 0 || ['EXPIRED', 'CANCELLED', 'CONSUMED'].includes(challenge.status);
  const verified = challenge.status === 'VERIFIED' && !expired;
  const ready = challenge.connectionState === 'HEALTHY' && Boolean(code) && !busy;
  const unavailable = challenge.connectionState === 'UNHEALTHY';
  const countdown = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;

  if (verified) {
    return (
      <section className="identity-verification is-verified" aria-label="B站身份验证">
        <div className="identity-result" role="status">
          <CircleCheck aria-hidden="true" size={23} />
          <div>
            <h2>身份验证成功</h2>
            <p>已验证 UID {challenge.biliUid}</p>
          </div>
        </div>
        {challenge.purpose === 'RECOVER' ? (
          challenge.username ? (
            <p className="identity-account">
              你的用户名：<strong>{challenge.username}</strong>
            </p>
          ) : (
            <InlineNotice tone="warning">
              没有可找回的账号，或账号信息已变化。请重新验证，或前往注册。
            </InlineNotice>
          )
        ) : null}
        <button
          className="text-button identity-reset"
          disabled={busy}
          onClick={onChangeIdentity}
          type="button"
        >
          更换验证账号
        </button>
      </section>
    );
  }

  return (
    <section className="identity-verification" aria-label="B站身份验证" aria-busy={busy}>
      <header className="identity-verification-header">
        <span className="identity-verification-icon">
          <MessageSquare aria-hidden="true" size={21} />
        </span>
        <div>
          <h2>发送弹幕，验证身份</h2>
          <p>
            {recoveryUid ? (
              <>
                请使用 UID <strong>{recoveryUid}</strong> 的 B站账号。
              </>
            ) : (
              '请使用你要绑定的 B站账号。'
            )}
          </p>
        </div>
      </header>

      {expired ? (
        <div className="identity-verification-body">
          <InlineNotice tone="warning">本次验证已失效，请重新验证。</InlineNotice>
          <button className="button primary wide" disabled={busy} onClick={onRestart} type="button">
            <RefreshCw aria-hidden="true" size={17} />
            {busy ? '正在生成验证码…' : '重新验证 B站身份'}
          </button>
        </div>
      ) : (
        <div className="identity-verification-body">
          <div className="identity-code-heading">
            <h3>复制验证码</h3>
            <span
              className="identity-countdown"
              role="timer"
              aria-live="off"
              aria-label={`验证码剩余 ${remaining} 秒`}
            >
              <Clock3 aria-hidden="true" size={14} />
              {countdown} 内有效
            </span>
          </div>
          {ready && code ? (
            <>
              <VerificationCode key={code} code={code} />
              <div className="identity-room">
                <div className="identity-room-heading">
                  <h3>前往直播间发送</h3>
                  <span>{challenge.room.displayName}</span>
                </div>
                <a
                  className="button primary wide"
                  href={challenge.room.link}
                  target="_blank"
                  rel="noreferrer"
                  aria-describedby="identity-room-help"
                >
                  打开验证直播间
                  <ExternalLink aria-hidden="true" size={17} />
                </a>
                <p id="identity-room-help">在新标签页打开 · 发送后回到本页继续</p>
              </div>
            </>
          ) : null}
          <div className={`identity-waiting${unavailable ? ' is-unavailable' : ''}`} role="status">
            <LoaderCircle className="spinner" aria-hidden="true" size={17} />
            <div>
              <strong>
                {busy
                  ? '正在生成新的验证码'
                  : unavailable
                    ? '正在恢复验证连接'
                    : ready
                      ? '等待你的验证弹幕'
                      : '正在连接验证直播间'}
              </strong>
              <p>
                {busy
                  ? '请使用即将显示的新验证码。'
                  : unavailable
                    ? '验证连接暂时不可用，正在重试。恢复后请重新发送验证码。'
                    : ready
                      ? '验证通过后，本页会自动进入下一步。'
                      : '连接就绪后会显示验证码，请稍候。'}
              </p>
            </div>
          </div>
        </div>
      )}
      {!expired || recoveryUid ? (
        <footer className="identity-verification-footer">
          {!expired ? (
            <>
              <button
                className="text-button identity-reset"
                disabled={busy}
                onClick={onRestart}
                type="button"
              >
                <RefreshCw aria-hidden="true" size={14} />
                重新获取验证码
              </button>
              <p>重新获取后，旧验证码将失效。</p>
            </>
          ) : null}
          {recoveryUid ? (
            <button
              className="text-button identity-reset"
              disabled={busy}
              onClick={onChangeIdentity}
              type="button"
            >
              更换 B站 UID
            </button>
          ) : null}
        </footer>
      ) : null}
    </section>
  );
}
