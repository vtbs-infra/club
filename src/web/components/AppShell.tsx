import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Bell,
  CalendarSync,
  ChevronDown,
  ClipboardList,
  Gift,
  LayoutDashboard,
  Link2,
  LogOut,
  MapPin,
  Megaphone,
  Menu,
  Palette,
  RadioTower,
  Settings,
  UserRound,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Suspense, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';

import { getIdentity, signOut, type AccountRole, type Identity } from '../api/client';
import { ApiError } from '../api/http';
import { ProductBrand } from './ProductBrand';
import { ErrorState, LoadingState } from './Ui';

interface NavigationItem {
  readonly end?: boolean;
  readonly icon: LucideIcon;
  readonly label: string;
  readonly to: string;
}

const userNavigation: readonly NavigationItem[] = [
  { end: true, icon: LayoutDashboard, label: '仪表盘', to: '/dashboard' },
  { icon: Gift, label: '礼物单', to: '/gifts' },
  { icon: Bell, label: '公告', to: '/announcements' },
];

const creatorNavigation: readonly NavigationItem[] = [
  { end: true, icon: LayoutDashboard, label: '概览', to: '/creator' },
  { icon: Gift, label: '礼物发布', to: '/creator/releases' },
  { icon: ClipboardList, label: '礼物单', to: '/creator/orders' },
  { icon: Megaphone, label: '公告', to: '/creator/announcements' },
  { icon: Settings, label: '设置', to: '/creator/settings' },
];

const adminNavigation: readonly NavigationItem[] = [
  { end: true, icon: LayoutDashboard, label: '概览', to: '/admin' },
  { icon: UsersRound, label: '主播', to: '/admin/creators' },
  { icon: CalendarSync, label: '名单同步', to: '/admin/rosters' },
  { icon: RadioTower, label: '验证直播间', to: '/admin/verification' },
  { icon: Megaphone, label: '平台公告', to: '/admin/announcements' },
  { icon: Palette, label: '主题', to: '/admin/appearance' },
  { icon: Activity, label: '系统', to: '/admin/system' },
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
  const navigation =
    area === 'admin' ? adminNavigation : area === 'creator' ? creatorNavigation : userNavigation;
  const accountDisplayName = identity.creator?.displayName ?? identity.user.name;

  return (
    <div className={`app-frame frame-${area}`}>
      <header className="topbar">
        <div className="topbar-inner">
          <ProductBrand
            context={area === 'user' ? '礼物中心' : area === 'creator' ? '主播工作台' : '平台管理'}
          />
          <button
            aria-controls="main-navigation"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? '关闭导航' : '打开导航'}
            className="menu-toggle"
            onClick={() => setMenuOpen((open) => !open)}
            type="button"
          >
            {menuOpen ? <X aria-hidden="true" size={22} /> : <Menu aria-hidden="true" size={22} />}
          </button>
          <nav
            className={menuOpen ? 'main-nav nav-open' : 'main-nav'}
            aria-label="主导航"
            id="main-navigation"
          >
            {navigation.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
                  key={item.to}
                  onClick={() => setMenuOpen(false)}
                  to={item.to}
                  {...(item.end === undefined ? {} : { end: item.end })}
                >
                  <Icon aria-hidden="true" size={17} />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
          <div className="account-menu">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  aria-label={`${accountDisplayName}的账号菜单`}
                  className="account-trigger"
                  type="button"
                >
                  <span className="avatar">{accountDisplayName.slice(0, 1).toUpperCase()}</span>
                  <span className="account-name">{accountDisplayName}</span>
                  <ChevronDown aria-hidden="true" className="account-chevron" size={15} />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  className="account-popover"
                  collisionPadding={12}
                  sideOffset={8}
                >
                  <DropdownMenu.Label className="account-popover-header">
                    <strong>{identity.user.name}</strong>
                    <small>{identity.user.email}</small>
                  </DropdownMenu.Label>
                  {area === 'user' ? (
                    <>
                      <DropdownMenu.Item asChild>
                        <Link to="/account">
                          <UserRound aria-hidden="true" size={16} />
                          <span>账号</span>
                        </Link>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item asChild>
                        <Link to="/account/bilibili">
                          <Link2 aria-hidden="true" size={16} />
                          <span>B站绑定</span>
                        </Link>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item asChild>
                        <Link to="/account/addresses">
                          <MapPin aria-hidden="true" size={16} />
                          <span>收货地址</span>
                        </Link>
                      </DropdownMenu.Item>
                    </>
                  ) : null}
                  <DropdownMenu.Item asChild>
                    <button
                      type="button"
                      onClick={async () => {
                        await signOut();
                        queryClient.removeQueries({
                          predicate: (query) => query.queryKey[0] !== 'appearance',
                        });
                        queryClient.getMutationCache().clear();
                        window.location.replace('/login');
                      }}
                    >
                      <LogOut aria-hidden="true" size={16} />
                      <span>退出登录</span>
                    </button>
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </div>
      </header>
      <main className="page-shell" key={location.pathname}>
        <Suspense fallback={<LoadingState label="正在打开页面…" />}>
          <Outlet context={{ identity }} />
        </Suspense>
      </main>
      <footer className="app-footer">
        <span>Club · 开源舰长礼物领取与发货平台</span>
      </footer>
    </div>
  );
}
