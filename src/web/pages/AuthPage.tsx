import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { getIdentity, registerAccount, signIn } from '../api/client';
import { ErrorNotice, InlineNotice } from '../components/Ui';

export function AuthPage({ mode }: { readonly mode: 'login' | 'register' }) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const isRegister = mode === 'register';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      if (isRegister) {
        await registerAccount(email, name, password);
        setPassword('');
        await navigate('/login', { replace: true, state: { registered: true } });
      } else {
        await signIn(email, password);
        const identity = await getIdentity();
        queryClient.setQueryData(['identity'], identity);
        setPassword('');
        await navigate('/app', { replace: true });
      }
    } catch (caught) {
      setError(caught);
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="auth-page">
      <Link className="brand auth-brand" to="/">
        <span className="brand-mark">✦</span>
        <span>Club</span>
      </Link>
      <section className="auth-card">
        <div className="auth-welcome">
          <div className="auth-stars" aria-hidden="true">
            ✦ ★ ✧
          </div>
          <p className="eyebrow">WELCOME TO CLUB</p>
          <h2>{isRegister ? '创建你的 Club 账号' : '欢迎回来'}</h2>
          <p>
            {isRegister
              ? '注册后绑定 B站 UID，即可自动匹配属于你的舰长礼物。'
              : '登录后继续查看礼物、处理发货或管理平台。'}
          </p>
          <div className="auth-illustration" aria-hidden="true">
            <span>✦</span>
            <div>GIFT</div>
            <span>★</span>
          </div>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <div>
            <p className="eyebrow">{isRegister ? '注册' : '登录'}</p>
            <h1>{isRegister ? '开始使用 Club' : '进入你的工作台'}</h1>
          </div>
          {!isRegister &&
          (location.state as { readonly registered?: boolean } | null)?.registered ? (
            <InlineNotice tone="success">账号已创建，请使用刚才填写的邮箱和密码登录。</InlineNotice>
          ) : null}
          {isRegister ? (
            <label>
              昵称
              <input
                autoComplete="name"
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                required
                value={name}
              />
            </label>
          ) : null}
          <label>
            邮箱
            <input
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <label>
            密码
            <input
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          {error ? <ErrorNotice error={error} /> : null}
          <button className="button primary wide" disabled={pending} type="submit">
            {pending ? '请稍候…' : isRegister ? '创建账号' : '登录'}
          </button>
          <p className="auth-switch">
            {isRegister ? '已经有账号？' : '还没有账号？'}
            <Link to={isRegister ? '/login' : '/register'}>
              {isRegister ? '立即登录' : '免费注册'}
            </Link>
          </p>
        </form>
      </section>
    </main>
  );
}
