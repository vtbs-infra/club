import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Gift, ShieldCheck, Sparkles } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  createIdentityChallenge,
  getIdentityChallenge,
  getIdentity,
  recoverAccount,
  registerAccount,
  signIn,
  type IdentityChallenge,
} from '../api/auth';
import { useSession } from '../app/session-context';
import { ProductBrand } from '../components/ProductBrand';
import { ErrorNotice, InlineNotice } from '../components/Ui';
import { useNow } from '../hooks/useNow';

export function AuthPage({ mode }: { readonly mode: 'login' | 'register' | 'recover' }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { acceptIdentity, endSession } = useSession();
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [uid, setUid] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const [issued, setIssued] = useState<IdentityChallenge | null>(null);
  const now = useNow(1000);
  const isRegister = mode === 'register';
  const isRecover = mode === 'recover';
  const isLogin = mode === 'login';
  const challengeQuery = useQuery({
    queryKey: ['identity-challenge', issued?.id],
    queryFn: () => getIdentityChallenge(issued!.id),
    enabled: Boolean(issued),
    retry: 1,
    staleTime: 0,
    refetchInterval: (query) => (query.state.data?.status === 'PENDING' ? 2000 : false),
  });
  const challenge = challengeQuery.data ?? issued;
  const expired = challenge ? new Date(challenge.expiresAt).getTime() <= now : false;
  const verified = challenge?.status === 'VERIFIED' && !expired;
  const canComplete = isLogin || (verified && (isRegister || Boolean(challenge?.username)));
  const message = location.state as { registered?: boolean; passwordChanged?: boolean } | null;

  async function startChallenge(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setPassword('');
    setConfirmation('');
    try {
      setIssued(
        await createIdentityChallenge(
          isRecover ? { purpose: 'RECOVER', biliUid: uid } : { purpose: 'REGISTER' },
        ),
      );
    } catch (caught) {
      setError(caught);
    } finally {
      setPending(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canComplete || (!isLogin && password !== confirmation)) return;
    setPending(true);
    setError(null);
    try {
      if (isRegister) {
        await registerAccount({ challengeId: challenge!.id, username, name, password });
        await navigate('/login', { replace: true, state: { registered: true } });
      } else if (isRecover) {
        await recoverAccount(challenge!.id, password);
        endSession();
        await navigate('/login', { replace: true, state: { passwordChanged: true } });
      } else {
        await signIn(username, password);
        acceptIdentity(await getIdentity());
        await navigate('/app', { replace: true });
      }
      setPassword('');
      setConfirmation('');
    } catch (caught) {
      setError(caught);
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="auth-page">
      <ProductBrand className="auth-brand" />
      <section className="auth-card">
        <div className="auth-welcome">
          <div className="auth-stars" aria-hidden="true">
            <Sparkles size={22} />
            <Sparkles size={15} />
            <Sparkles size={19} />
          </div>
          <p className="eyebrow">舰长礼物，一处完成</p>
          <h2>
            {isRegister ? '创建你的 Club 账号' : isRecover ? '找回你的 Club 账号' : '欢迎回来'}
          </h2>
          <p>
            {isRegister
              ? '先验证 B站身份，再设置登录账号。属于你的礼物会自动匹配。'
              : isRecover
                ? '使用注册时验证的 B站账号找回用户名，并设置新密码。'
                : '使用用户名和密码登录，继续查看礼物或管理工作台。'}
          </p>
          <div className="auth-illustration" aria-hidden="true">
            <span className="auth-illustration-spark">
              <Sparkles size={24} />
            </span>
            <div>
              <Gift size={56} strokeWidth={1.55} />
            </div>
          </div>
          <div className="auth-trust-line">
            <ShieldCheck size={18} />
            <span>无需提供 B站密码</span>
          </div>
        </div>
        <div className="auth-form">
          <div>
            <p className="eyebrow">
              {isRegister ? '创建账号' : isRecover ? '账号找回' : '账号登录'}
            </p>
            <h1>{isRegister ? '开始使用 Club' : isRecover ? '重置密码' : '进入你的工作台'}</h1>
          </div>
          {isLogin && message?.registered ? (
            <InlineNotice tone="success">账号已创建，请使用用户名和密码登录。</InlineNotice>
          ) : null}
          {isLogin && message?.passwordChanged ? (
            <InlineNotice tone="success">密码已更新，请重新登录。</InlineNotice>
          ) : null}
          {!isLogin ? (
            <div className="stack-md">
              <form className="stack-md" onSubmit={startChallenge}>
                {isRecover ? (
                  <label>
                    B站 UID
                    <input
                      autoComplete="off"
                      inputMode="numeric"
                      maxLength={20}
                      pattern="[1-9][0-9]*"
                      required
                      value={uid}
                      onChange={(event) => setUid(event.target.value)}
                    />
                  </label>
                ) : null}
                <button className="button secondary wide" type="submit" disabled={pending}>
                  {pending ? '请稍候…' : issued ? '重新验证 B站身份' : '验证 B站身份'}
                </button>
              </form>
              {challenge ? (
                <div className="identity-verification" aria-live="polite">
                  {verified ? (
                    <InlineNotice tone="success">已验证 UID {challenge.biliUid}</InlineNotice>
                  ) : expired || ['EXPIRED', 'CANCELLED', 'CONSUMED'].includes(challenge.status) ? (
                    <InlineNotice tone="warning">本次验证已失效，请重新验证。</InlineNotice>
                  ) : (
                    <>
                      <p>
                        用你的 B站账号前往{' '}
                        <a href={challenge.room.link} target="_blank" rel="noreferrer">
                          {challenge.room.displayName}
                        </a>{' '}
                        发送下方验证码，然后回到本页继续。
                      </p>
                      <code className="identity-code">{issued?.code}</code>
                      <p>
                        验证码剩余{' '}
                        {Math.max(
                          0,
                          Math.ceil((new Date(challenge.expiresAt).getTime() - now) / 1000),
                        )}{' '}
                        秒
                      </p>
                      <p role="status">
                        {challenge.connectionState === 'UNHEALTHY'
                          ? '验证连接暂时不可用，正在重试…'
                          : '正在等待 B站消息…'}
                      </p>
                    </>
                  )}
                  {verified && isRecover ? (
                    challenge.username ? (
                      <p>
                        你的用户名：<strong>{challenge.username}</strong>
                      </p>
                    ) : (
                      <InlineNotice tone="warning">
                        没有可找回的账号，或账号信息已变化。请重新验证，或前往注册。
                      </InlineNotice>
                    )
                  ) : null}
                </div>
              ) : (
                <p className="muted">
                  验证通过后继续填写{isRegister ? '用户名和密码' : '新密码'}。
                </p>
              )}
              {challengeQuery.isError ? <ErrorNotice error={challengeQuery.error} /> : null}
            </div>
          ) : null}
          {canComplete ? (
            <form className="stack-md" onSubmit={submit}>
              {!isRecover ? (
                <label>
                  <span id="auth-username-label">用户名</span>
                  <input
                    aria-labelledby="auth-username-label"
                    aria-describedby={isRegister ? 'auth-username-help' : undefined}
                    autoCapitalize="none"
                    autoComplete="username"
                    minLength={3}
                    maxLength={30}
                    pattern="[A-Za-z0-9_]+"
                    required
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                  />
                  {isRegister ? (
                    <small id="auth-username-help">
                      3–30 位字母、数字或下划线，不区分大小写，注册后不可修改。
                    </small>
                  ) : null}
                </label>
              ) : null}
              {isRegister ? (
                <label>
                  昵称
                  <input
                    autoComplete="nickname"
                    maxLength={80}
                    required
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
              ) : null}
              <label>
                <span id="auth-password-label">{isLogin ? '密码' : '新密码'}</span>
                <input
                  aria-labelledby="auth-password-label"
                  aria-describedby={isLogin ? undefined : 'auth-password-help'}
                  autoComplete={isLogin ? 'current-password' : 'new-password'}
                  minLength={isLogin ? 1 : 12}
                  maxLength={128}
                  required
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                {!isLogin ? (
                  <small id="auth-password-help">至少 12 个字符，可使用密码管理器生成。</small>
                ) : null}
              </label>
              {!isLogin ? (
                <label>
                  确认密码
                  <input
                    autoComplete="new-password"
                    maxLength={128}
                    required
                    type="password"
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                  />
                </label>
              ) : null}
              {!isLogin && confirmation && confirmation !== password ? (
                <InlineNotice tone="warning">两次输入的密码不一致。</InlineNotice>
              ) : null}
              <button
                className="button primary wide"
                disabled={pending || (!isLogin && password !== confirmation)}
                type="submit"
              >
                {pending ? '请稍候…' : isRegister ? '创建账号' : isRecover ? '设置新密码' : '登录'}
                <ArrowRight aria-hidden="true" size={17} />
              </button>
            </form>
          ) : null}
          {error ? <ErrorNotice error={error} /> : null}
          <p className="auth-switch">
            {isLogin ? '还没有账号？' : '已经有账号？'}
            <Link to={isLogin ? '/register' : '/login'}>{isLogin ? '免费注册' : '立即登录'}</Link>
          </p>
          {isLogin ? (
            <p className="auth-switch">
              <Link to="/recover">忘记用户名或密码？</Link>
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
