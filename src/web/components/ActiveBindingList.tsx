import { useInfiniteQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { getAdminBilibiliBindings, type AdminBilibiliBinding } from '../api/client';
import { formatDate } from '../lib/format';
import { EmptyState, ErrorState, LoadingState } from './Ui';

const roleLabels: Record<AdminBilibiliBinding['user']['role'], string> = {
  CREATOR: '主播',
  PLATFORM_ADMIN: '平台管理员',
  USER: '普通用户',
};

export function ActiveBindingList() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const bindings = useInfiniteQuery({
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      getAdminBilibiliBindings({
        cursor: pageParam,
        search: search || undefined,
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    queryKey: ['admin', 'bilibili-bindings', search],
  });
  const items = bindings.data?.pages.flatMap((page) => page.items) ?? [];
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setSearch(searchInput.trim());
  };
  const clearSearch = () => {
    setSearchInput('');
    setSearch('');
  };

  return (
    <section className="panel">
      <div className="section-heading compact">
        <div>
          <p className="eyebrow">当前绑定</p>
          <h2>有效的 B站 UID 归属</h2>
          <p>按 UID、B站昵称或平台账号核对当前归属；绑定关系只能通过既定流程变更。</p>
        </div>
        <form className="form-actions binding-search-form" onSubmit={submitSearch}>
          <label className="search-field">
            <span className="sr-only">搜索当前 B站绑定</span>
            <Search aria-hidden="true" size={17} />
            <input
              maxLength={100}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="UID、B站昵称、用户名或邮箱"
              value={searchInput}
            />
          </label>
          <button className="button secondary compact" type="submit">
            查询
          </button>
          {search ? (
            <button className="button ghost compact" onClick={clearSearch} type="button">
              清除
            </button>
          ) : null}
        </form>
      </div>
      {bindings.isPending ? (
        <LoadingState label="正在读取当前绑定…" />
      ) : bindings.isError ? (
        <ErrorState
          error={bindings.error}
          onRetry={() => void bindings.refetch()}
          retryLabel="重试绑定列表"
          title="当前绑定暂时无法加载"
        />
      ) : items.length === 0 ? (
        <EmptyState
          description={search ? '请尝试输入更短或更准确的前缀。' : '用户完成验证后会显示在这里。'}
          title={search ? '没有找到匹配的绑定' : '当前没有有效绑定'}
        />
      ) : (
        <>
          <div className="orders-table-wrap">
            <table className="data-table active-binding-table">
              <caption className="sr-only">当前有效的 B站绑定</caption>
              <thead>
                <tr>
                  <th>B站账号</th>
                  <th>平台账号</th>
                  <th>身份</th>
                  <th>绑定时间</th>
                </tr>
              </thead>
              <tbody>
                {items.map((binding) => (
                  <tr key={binding.id}>
                    <td>
                      <strong>{binding.biliDisplayName ?? '未获取昵称'}</strong>
                      <small>UID {binding.biliUid}</small>
                    </td>
                    <td>
                      <strong>{binding.user.name}</strong>
                      <small>{binding.user.email}</small>
                    </td>
                    <td>
                      <span className="soft-tag">{roleLabels[binding.user.role]}</span>
                    </td>
                    <td>{formatDate(binding.boundAt, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {bindings.hasNextPage ? (
            <div className="list-actions">
              <button
                className="button secondary"
                disabled={bindings.isFetchingNextPage}
                onClick={() => void bindings.fetchNextPage()}
                type="button"
              >
                {bindings.isFetchingNextPage ? '正在加载…' : '加载更多绑定'}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
