import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { changePassword, getIdentity, updateProfile, type Identity } from '../api/auth';
import { useSession } from '../app/session-context';
import { AddressBook } from '../components/AddressEditor';
import { ErrorNotice, ErrorState, InlineNotice, LoadingState, PageHeader } from '../components/Ui';

function AccountTabs() {
  return (
    <nav className="subnav" aria-label="账号设置">
      <NavLink end to="/account">
        账号信息
      </NavLink>
      <NavLink to="/account/addresses">收货地址</NavLink>
    </nav>
  );
}
function ProfileEditor({ identity }: { readonly identity: Identity }) {
  const client = useQueryClient();
  const [name, setName] = useState(identity.user.name);
  const save = useMutation({
    mutationFn: () => updateProfile(name),
    onSuccess: () => client.invalidateQueries({ queryKey: ['identity'] }),
  });
  return (
    <form
      className="panel stack-md"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <h2>账号信息</h2>
      <label>
        用户名
        <input readOnly value={identity.user.username} />
      </label>
      <p>
        {identity.user.bilibiliUid
          ? '已验证 B站 UID：' + identity.user.bilibiliUid
          : '平台管理员账号'}
      </p>
      <label>
        昵称
        <input
          maxLength={80}
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      {save.isError ? <ErrorNotice error={save.error} /> : null}
      {save.isSuccess ? <InlineNotice tone="success">昵称已更新。</InlineNotice> : null}
      <div>
        <button className="button primary" disabled={save.isPending || !name.trim()} type="submit">
          保存昵称
        </button>
      </div>
    </form>
  );
}
function PasswordEditor() {
  const { endSession } = useSession();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const save = useMutation({
    mutationFn: () => changePassword(current, password),
    onSuccess: async () => {
      endSession();
      await navigate('/login', { replace: true, state: { passwordChanged: true } });
    },
  });
  return (
    <form
      className="panel stack-md"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (password === confirmation) save.mutate();
      }}
    >
      <h2>修改密码</h2>
      <p>修改后所有设备都需要重新登录。</p>
      <label>
        当前密码
        <input
          autoComplete="current-password"
          maxLength={128}
          required
          type="password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
        />
      </label>
      <label>
        新密码
        <input
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
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
      {confirmation && confirmation !== password ? (
        <InlineNotice tone="warning">两次输入的密码不一致。</InlineNotice>
      ) : null}
      {save.isError ? <ErrorNotice error={save.error} /> : null}
      <div>
        <button
          className="button primary"
          disabled={save.isPending || password !== confirmation}
          type="submit"
        >
          更新密码
        </button>
      </div>
    </form>
  );
}
export function AccountPage() {
  const identity = useQuery({ queryFn: getIdentity, queryKey: ['identity'] });
  if (identity.isPending) return <LoadingState />;
  if (identity.isError || !identity.data) return <ErrorState error={identity.error} />;
  return (
    <div className="stack-lg">
      <PageHeader eyebrow="账号资料" intro="管理登录账号、密码和领取所需资料。" title="账号" />
      <AccountTabs />
      <ProfileEditor identity={identity.data} />
      <PasswordEditor />
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
