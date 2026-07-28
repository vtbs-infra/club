import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { getAddresses, getAnnouncements, getBinding, getIdentity, getMyGifts } from '../api/client';
import { GiftCard } from '../components/GiftCard';
import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../components/Ui';
import { formatDate } from '../lib/format';

const dashboardLoadedAt = Date.now();

export function DashboardPage() {
  const identity = useQuery({ queryFn: getIdentity, queryKey: ['identity'] });
  const announcements = useQuery({
    queryFn: () => getAnnouncements(5),
    queryKey: ['me', 'announcements', 5],
  });
  const gifts = useQuery({ queryFn: () => getMyGifts(12), queryKey: ['gifts', 'mine', 12] });
  const binding = useQuery({ queryFn: getBinding, queryKey: ['me', 'bilibili-binding'] });
  const addresses = useQuery({ queryFn: getAddresses, queryKey: ['me', 'addresses'] });

  if (identity.isPending || gifts.isPending) return <LoadingState label="正在准备仪表盘…" />;
  if (identity.isError || gifts.isError)
    return <ErrorState error={identity.error ?? gifts.error} />;
  const claimable = gifts.data.filter((gift) => gift.status === 'CLAIMABLE');
  const shipped = gifts.data.find((gift) => gift.status === 'SHIPPED');
  const urgent = claimable.find(
    (gift) => new Date(gift.release.claimDeadlineAt).getTime() - dashboardLoadedAt < 3 * 86_400_000,
  );

  return (
    <div className="dashboard stack-xl">
      <section className="dashboard-banner">
        <div className="banner-stars" aria-hidden="true">
          <span>★</span>
          <span>✦</span>
          <span>☆</span>
          <span>★</span>
          <span>✧</span>
        </div>
        <div>
          <p>WELCOME BACK</p>
          <h1>欢迎回来，{identity.data.user.name}！</h1>
          <span>
            {claimable.length > 0
              ? `你有 ${claimable.length} 份礼物等待领取。`
              : '新的舰长礼物会自动出现在这里。'}
          </span>
        </div>
      </section>

      <section className="dashboard-news">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">RECENT NEWS</p>
            <h2>近期资讯</h2>
          </div>
          <Link className="text-action" to="/announcements">
            查看全部 →
          </Link>
        </div>
        {announcements.isPending ? <LoadingState label="正在读取资讯…" /> : null}
        {announcements.data?.length === 0 ? (
          <p className="quiet-line">暂时没有新公告。</p>
        ) : (
          <div className="news-list">
            {announcements.data?.map((announcement) => (
              <Link key={announcement.id} to="/announcements">
                <StatusBadge status={announcement.severity}>
                  {announcement.severity === 'INFO'
                    ? '公告'
                    : announcement.severity === 'WARNING'
                      ? '重要'
                      : '紧急'}
                </StatusBadge>
                {announcement.pinned ? <span className="pin-label">置顶</span> : null}
                <strong>{announcement.title}</strong>
                <time>{announcement.publishedAt ? formatDate(announcement.publishedAt) : ''}</time>
              </Link>
            ))}
          </div>
        )}
      </section>

      {!binding.data ? (
        <section className="action-callout">
          <div className="callout-icon">B</div>
          <div>
            <strong>绑定 B站账号，自动找回你的礼物</strong>
            <p>只需前往平台指定直播间发送一次性验证码。</p>
          </div>
          <Link className="button primary" to="/account/bilibili">
            开始绑定
          </Link>
        </section>
      ) : claimable.length > 0 && addresses.data?.length === 0 ? (
        <section className="action-callout">
          <div className="callout-icon">⌂</div>
          <div>
            <strong>先保存一个收货地址</strong>
            <p>领取礼物时可以直接选择，提交后地址会冻结。</p>
          </div>
          <Link className="button primary" to="/account/addresses">
            添加地址
          </Link>
        </section>
      ) : urgent ? (
        <section className="action-callout urgent">
          <div className="callout-icon">!</div>
          <div>
            <strong>“{urgent.release.title}”即将截止</strong>
            <p>请在 {formatDate(urgent.release.claimDeadlineAt, true)} 前完成领取。</p>
          </div>
          <Link className="button primary" to={`/gifts/${urgent.id}`}>
            现在领取
          </Link>
        </section>
      ) : shipped ? (
        <section className="action-callout success">
          <div className="callout-icon">✓</div>
          <div>
            <strong>一份礼物正在向你出发</strong>
            <p>物流状态已经更新，可以随时查看。</p>
          </div>
          <Link className="button primary" to={`/gifts/${shipped.id}`}>
            查看物流
          </Link>
        </section>
      ) : null}

      <section>
        <div className="section-heading">
          <div>
            <p className="eyebrow">MY GIFTS</p>
            <h2>我的礼物单</h2>
            <p>资格、领取和物流状态都集中在同一张礼物单中。</p>
          </div>
          <Link className="button ghost" to="/gifts">
            全部礼物
          </Link>
        </div>
        {gifts.data.length === 0 ? (
          <EmptyState
            action={
              binding.data ? null : (
                <Link className="button secondary" to="/account/bilibili">
                  绑定 B站账号
                </Link>
              )
            }
            description={
              binding.data
                ? '主播发布礼物并完成月末名单同步后，属于你的礼物会自动出现。'
                : '完成 B站 UID 绑定后，系统会匹配现在和过去属于你的礼物。'
            }
            title="目前没有礼物单"
          />
        ) : (
          <div className="gift-grid">
            {gifts.data.slice(0, 6).map((gift) => (
              <GiftCard key={gift.id} order={gift} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
