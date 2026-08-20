import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { getMyGifts, type GiftOrderStatus } from '../api/client';
import { GiftCard } from '../components/GiftCard';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '../components/Ui';

const filters: readonly { readonly label: string; readonly values: readonly GiftOrderStatus[] }[] =
  [
    { label: '全部', values: [] },
    { label: '待领取', values: ['CLAIMABLE'] },
    { label: '等待发货', values: ['SUBMITTED'] },
    { label: '已发货', values: ['SHIPPED'] },
    { label: '已完成', values: ['COMPLETED'] },
    { label: '已结束', values: ['EXPIRED', 'CANCELLED'] },
  ];

export function GiftsPage() {
  const gifts = useQuery({ queryFn: () => getMyGifts(), queryKey: ['gifts', 'mine'] });
  const [active, setActive] = useState(0);
  if (gifts.isPending) return <LoadingState label="正在读取礼物单…" />;
  if (gifts.isError) return <ErrorState error={gifts.error} />;
  const values = filters[active]!.values;
  const visible =
    values.length === 0 ? gifts.data : gifts.data.filter((gift) => values.includes(gift.status));
  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="MY GIFT ORDERS"
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
        <div className="gift-grid">
          {visible.map((gift) => (
            <GiftCard key={gift.id} order={gift} />
          ))}
        </div>
      )}
    </div>
  );
}
