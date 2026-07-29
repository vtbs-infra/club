import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';

import { getIdentity, signOut, type AccountRole, type Identity } from '../api/client';
import { ApiError } from '../api/http';
import { ErrorState, LoadingState } from './Ui';

interface NavigationItem {
  readonly end?: boolean;
  readonly label: string;
  readonly to: string;
}

const userNavigation: readonly NavigationItem[] = [
  { end: true, label: '仪表盘', to: '/dashboard' },
  { label: '礼物单', to: '/gifts' },
  { label: '公告', to: '/announcements' },
];

const creatorNavigation: readonly NavigationItem[] = [
  { end: true, label: '概览', to: '/creator' },
  { label: '礼物发布', to: '/creator/releases' },
  { label: '礼物单', to: '/creator/orders' },
  { label: '公告', to: '/creator/announcements' },
  { label: '设置', to: '/creator/settings' },
];

const adminNavigation: readonly NavigationItem[] = [
  { end: true, label: '概览', to: '/admin' },
  { label: '主播', to: '/admin/creators' },
  { label: '名单同步', to: '/admin/rosters' },
  { label: '验证直播间', to: '/admin/verification' },
  { label: '平台公告', to: '/admin/announcements' },
  { label: '系统', to: '/admin/system' },
];

function roleHome(role: AccountRole): string {
  if (role === 'CREATOR') return '/creator';
  if (role === 'PLATFORM_ADMIN') return '/admin';
  return '/dashboard';
}

export function RoleLanding() {
  const identity = useQuery({ queryFn: getIdentity, queryKey: ['identity'], retry: false });
  if (identity.isPending)
    return (
      <main className="centered-state">
        <LoadingState />
      </main>
    );
  if (identity.error instanceof ApiError && identity.error.status === 401) {
    return <Navigate replace to="/login" />;
  }
  if (identity.isError || !identity.data) {
    return (
      <main className="centered-state">
        <ErrorState error={identity.error} />
      </main>
    );
  }
  return <Navigate replace to={roleHome(identity.data.user.role)} />;
}

export function ProtectedLayout({ area }: { readonly area: 'admin' | 'creator' | 'user' }) {
  const identity = useQuery({ queryFn: getIdentity, queryKey: ['identity'], retry: false });
  if (identity.isPending)
    return (
      <main className="centered-state">
        <LoadingState label="正在读取账号…" />
      </main>
    );
  if (identity.error instanceof ApiError && identity.error.status === 401) {
    return <Navigate replace to="/login" />;
  }
  if (identity.isError || !identity.data) {
    return (
      <main className="centered-state">
        <ErrorState error={identity.error} />
      </main>
    );
  }
  const expectedRole: AccountRole =
    area === 'admin' ? 'PLATFORM_ADMIN' : area === 'creator' ? 'CREATOR' : 'USER';
  if (identity.data.user.role !== expectedRole) {
    return <Navigate replace to={roleHome(identity.data.user.role)} />;
  }
  return <Shell area={area} identity={identity.data} />;
}

function Shell({
  area,
  identity,
}: {
  readonly area: 'admin' | 'creator' | 'user';
  readonly identity: Identity;
}) {
  const location = useLocation();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const navigation =
    area === 'admin' ? adminNavigation : area === 'creator' ? creatorNavigation : userNavigation;

  useEffect(() => {
    if (!accountOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) setAccountOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setAccountOpen(false);
      accountTriggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [accountOpen]);

  return (
    <div className={`app-frame frame-${area}`}>
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" to={roleHome(identity.user.role)}>
            <span className="brand-mark" aria-hidden="true">
              ✦
            </span>
            <span>Club</span>
            {area !== 'user' ? (
              <small>{area === 'creator' ? '主播工作台' : '平台管理'}</small>
            ) : null}
          </Link>
          <button
            aria-expanded={menuOpen}
            aria-label="打开导航"
            className="menu-toggle"
            onClick={() => setMenuOpen((open) => !open)}
            type="button"
          >
            <span />
            <span />
            <span />
          </button>
          <nav className={menuOpen ? 'main-nav nav-open' : 'main-nav'} aria-label="主导航">
            {navigation.map((item) => (
              <NavLink
                className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
                key={item.to}
                onClick={() => setMenuOpen(false)}
                to={item.to}
                {...(item.end === undefined ? {} : { end: item.end })}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="account-menu" ref={accountMenuRef}>
            <button
              aria-expanded={accountOpen}
              aria-haspopup="menu"
              className="account-trigger"
              onClick={() => setAccountOpen((open) => !open)}
              ref={accountTriggerRef}
              type="button"
            >
              <span className="avatar">
                {(identity.creator?.displayName ?? identity.user.name).slice(0, 1).toUpperCase()}
              </span>
              <span className="account-name">
                {identity.creator?.displayName ?? identity.user.name}
              </span>
              <span aria-hidden="true">⌄</span>
            </button>
            {accountOpen ? (
              <div className="account-popover" role="menu">
                <div>
                  <strong>{identity.user.name}</strong>
                  <small>{identity.user.email}</small>
                </div>
                {area === 'user' ? (
                  <>
                    <Link onClick={() => setAccountOpen(false)} role="menuitem" to="/account">
                      账号
                    </Link>
                    <Link
                      onClick={() => setAccountOpen(false)}
                      role="menuitem"
                      to="/account/bilibili"
                    >
                      B站绑定
                    </Link>
                    <Link
                      onClick={() => setAccountOpen(false)}
                      role="menuitem"
                      to="/account/addresses"
                    >
                      收货地址
                    </Link>
                  </>
                ) : null}
                <button
                  role="menuitem"
                  type="button"
                  onClick={async () => {
                    await signOut();
                    queryClient.clear();
                    window.location.replace('/login');
                  }}
                >
                  退出登录
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>
      <main className="page-shell" key={location.pathname}>
        <Outlet context={{ identity }} />
      </main>
      <footer className="app-footer">
        <span>Club · 开源舰长礼物领取与发货平台</span>
      </footer>
    </div>
  );
}
