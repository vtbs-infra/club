import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { getMyGifts, type GiftOrderListFilter } from '../api/client';
import { GiftCard } from '../components/GiftCard';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '../components/Ui';
import { useNow } from '../hooks/useNow';

const filters: readonly { readonly label: string; readonly value: GiftOrderListFilter }[] = [
  { label: '全部', value: 'ALL' },
  { label: '待领取', value: 'CLAIMABLE' },
  { label: '等待发货', value: 'SUBMITTED' },
  { label: '已发货', value: 'SHIPPED' },
  { label: '已完成', value: 'COMPLETED' },
  { label: '已结束', value: 'ENDED' },
];

export function GiftsPage() {
  const now = useNow();
  const [active, setActive] = useState(0);
  const filter = filters[active]!.value;
  const gifts = useInfiniteQuery({
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => getMyGifts({ cursor: pageParam, filter }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    queryKey: ['gifts', 'mine', filter],
  });
  if (gifts.isPending) return <LoadingState label="正在读取礼物单…" />;
  if (gifts.isError) return <ErrorState error={gifts.error} />;
  const visible = gifts.data.pages.flatMap((page) => page.items);
  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="礼物中心"
        intro="每一张礼物单都来自已经冻结的月度大航海名单。"
        title="礼物单"
      />
      <div aria-label="按礼物状态筛选" className="filter-tabs" role="group">
        {filters.map((filter, index) => (
          <button
            aria-pressed={active === index}
            className={active === index ? 'active' : ''}
            key={filter.label}
            onClick={() => setActive(index)}
            type="button"
          >
            {filter.label}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <EmptyState description="这个状态下暂时没有礼物单。" title="没有匹配的礼物" />
      ) : (
        <>
          <div className="gift-grid">
            {visible.map((gift) => (
              <GiftCard key={gift.id} now={now} order={gift} />
            ))}
          </div>
          {gifts.hasNextPage ? (
            <div className="list-actions">
              <button
                className="button secondary"
                disabled={gifts.isFetchingNextPage}
                onClick={() => void gifts.fetchNextPage()}
                type="button"
              >
                {gifts.isFetchingNextPage ? '正在加载…' : '加载更早的礼物单'}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
