import { useQuery } from '@tanstack/react-query';
import { NavLink } from 'react-router-dom';

import { getBinding, getIdentity } from '../api/client';
import { AddressBook } from '../components/AddressEditor';
import { BilibiliPanel } from '../components/BilibiliPanel';
import { ErrorState, LoadingState, PageHeader, StatusBadge } from '../components/Ui';

function AccountTabs() {
  return (
    <nav className="subnav" aria-label="账号设置">
      <NavLink end to="/account">
        账号信息
      </NavLink>
      <NavLink to="/account/bilibili">B站绑定</NavLink>
      <NavLink to="/account/addresses">收货地址</NavLink>
    </nav>
  );
}

export function AccountPage() {
  const identity = useQuery({ queryFn: getIdentity, queryKey: ['identity'] });
  const binding = useQuery({ queryFn: getBinding, queryKey: ['me', 'bilibili-binding'] });
  if (identity.isPending) return <LoadingState />;
  if (identity.isError || !identity.data) return <ErrorState error={identity.error} />;
  return (
    <div className="stack-lg">
      <PageHeader eyebrow="账号资料" intro="管理你的登录账号和领取所需资料。" title="账号" />
      <AccountTabs />
      <section className="panel account-summary">
        <div className="large-avatar">{identity.data.user.name.slice(0, 1).toUpperCase()}</div>
        <div>
          <p className="eyebrow">账号信息</p>
          <h2>{identity.data.user.name}</h2>
          <p>{identity.data.user.email}</p>
        </div>
        <div className="account-status">
          <span>B站身份</span>
          <StatusBadge status={binding.data ? 'verified' : 'pending'}>
            {binding.data ? `已绑定 UID ${binding.data.biliUid}` : '尚未绑定'}
          </StatusBadge>
        </div>
      </section>
    </div>
  );
}

export function BilibiliAccountPage() {
  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="B站账号"
        intro="通过指定直播间确认礼物名单中的 UID 属于你。"
        title="B站绑定"
      />
      <AccountTabs />
      <BilibiliPanel />
    </div>
  );
}

export function AddressesAccountPage() {
  return (
    <div className="stack-lg">
      <PageHeader eyebrow="收货资料" intro="统一维护领取礼物时可选的收货地址。" title="收货地址" />
      <AccountTabs />
      <AddressBook />
    </div>
  );
}
