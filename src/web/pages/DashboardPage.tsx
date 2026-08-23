import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ClockAlert, Gift, Link2, MapPin, Sparkles, Truck } from 'lucide-react';
import { Link } from 'react-router-dom';

import { getAddresses, getAnnouncements, getBinding, getIdentity, getMyGifts } from '../api/client';
import { GiftCard } from '../components/GiftCard';
import { EmptyState, ErrorNotice, ErrorState, LoadingState, StatusBadge } from '../components/Ui';
import { useNow } from '../hooks/useNow';
import { formatDate } from '../lib/format';
import { announcementSeverityPresentation } from '../lib/status-presentation';

export function DashboardPage() {
  const now = useNow();
  const identity = useQuery({ queryFn: getIdentity, queryKey: ['identity'] });
  const announcements = useQuery({
    queryFn: () => getAnnouncements(5),
    queryKey: ['me', 'announcements', 5],
  });
  const gifts = useQuery({ queryFn: () => getMyGifts(12), queryKey: ['gifts', 'mine', 12] });
  const binding = useQuery({ queryFn: getBinding, queryKey: ['me', 'bilibili-binding'] });
  const addresses = useQuery({ queryFn: getAddresses, queryKey: ['me', 'addresses'] });

  if (identity.isPending) return <LoadingState label="正在准备仪表盘…" />;
  if (identity.isError) return <ErrorState error={identity.error} />;
  const visibleGifts = gifts.data ?? [];
  const claimable = visibleGifts.filter((gift) => gift.status === 'CLAIMABLE');
  const shipped = visibleGifts.find((gift) => gift.status === 'SHIPPED');
  const urgent = claimable.find((gift) => {
    const remaining = new Date(gift.release.claimDeadlineAt).getTime() - now;
    return remaining >= 0 && remaining < 3 * 86_400_000;
  });

  return (
    <div className="dashboard stack-xl">
      <section className="dashboard-banner">
        <div className="banner-stars" aria-hidden="true">
          <Sparkles size={18} />
          <Sparkles size={26} />
          <Sparkles size={15} />
        </div>
        <div className="dashboard-banner-copy">
          <p>欢迎回来</p>
          <h1>欢迎回来，{identity.data.user.name}！</h1>
          <span>
            {gifts.isPending
              ? '正在读取你的礼物单…'
              : gifts.isError
                ? '礼物单暂时无法读取，其他功能仍可继续使用。'
                : claimable.length > 0
                  ? `你有 ${claimable.length} 份礼物等待领取。`
                  : '新的舰长礼物会自动出现在这里。'}
          </span>
        </div>
        <div className="dashboard-banner-gift" aria-hidden="true">
          <Gift size={72} strokeWidth={1.45} />
        </div>
      </section>

      <section className="dashboard-news">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">平台动态</p>
            <h2>近期资讯</h2>
          </div>
          <Link className="text-action" to="/announcements">
            查看全部
            <ArrowRight aria-hidden="true" size={15} />
          </Link>
        </div>
        {announcements.isPending ? (
          <LoadingState label="正在读取资讯…" />
        ) : announcements.isError ? (
          <ErrorState
            error={announcements.error}
            onRetry={() => void announcements.refetch()}
            retryLabel="重试资讯"
            title="近期资讯暂时无法加载"
          />
        ) : announcements.data.length === 0 ? (
          <p className="quiet-line">暂时没有新公告。</p>
        ) : (
          <div className="news-list">
            {announcements.data.map((announcement) => (
              <Link
                key={announcement.id}
                to={`/announcements?open=${encodeURIComponent(announcement.id)}`}
              >
                <StatusBadge {...announcementSeverityPresentation[announcement.severity]} />
                {announcement.pinned ? <span className="pin-label">置顶</span> : null}
                <strong>{announcement.title}</strong>
                <time>{announcement.publishedAt ? formatDate(announcement.publishedAt) : ''}</time>
              </Link>
            ))}
          </div>
        )}
      </section>

      {binding.isError ? (
        <div className="stack-md">
          <ErrorNotice error={binding.error} />
          <button
            className="button secondary small"
            onClick={() => void binding.refetch()}
            type="button"
          >
            重试 B站绑定状态
          </button>
        </div>
      ) : null}
      {addresses.isError && binding.data && claimable.length > 0 ? (
        <div className="stack-md">
          <ErrorNotice error={addresses.error} />
          <button
            className="button secondary small"
            onClick={() => void addresses.refetch()}
            type="button"
          >
            重试收货地址
          </button>
        </div>
      ) : null}

      {!binding.isPending && !binding.isError && !binding.data ? (
        <section className="action-callout">
          <div className="callout-icon">
            <Link2 aria-hidden="true" size={22} />
          </div>
          <div>
            <strong>绑定 B站账号，自动找回你的礼物</strong>
            <p>只需前往平台指定直播间发送一次性验证码。</p>
          </div>
          <Link className="button primary" to="/account/bilibili">
            开始绑定
            <ArrowRight aria-hidden="true" size={16} />
          </Link>
        </section>
      ) : !addresses.isPending &&
        !addresses.isError &&
        binding.data &&
        claimable.length > 0 &&
        addresses.data.length === 0 ? (
        <section className="action-callout">
          <div className="callout-icon">
            <MapPin aria-hidden="true" size={22} />
          </div>
          <div>
            <strong>先保存一个收货地址</strong>
            <p>领取礼物时可以直接选择，提交后地址会冻结。</p>
          </div>
          <Link className="button primary" to="/account/addresses">
            添加地址
            <ArrowRight aria-hidden="true" size={16} />
          </Link>
        </section>
      ) : urgent ? (
        <section className="action-callout urgent">
          <div className="callout-icon">
            <ClockAlert aria-hidden="true" size={22} />
          </div>
          <div>
            <strong>“{urgent.release.title}”即将截止</strong>
            <p>请在 {formatDate(urgent.release.claimDeadlineAt, true)} 前完成领取。</p>
          </div>
          <Link className="button primary" to={`/gifts/${urgent.id}`}>
            现在领取
            <ArrowRight aria-hidden="true" size={16} />
          </Link>
        </section>
      ) : shipped ? (
        <section className="action-callout success">
          <div className="callout-icon">
            <Truck aria-hidden="true" size={22} />
          </div>
          <div>
            <strong>一份礼物正在向你出发</strong>
            <p>物流状态已经更新，可以随时查看。</p>
          </div>
          <Link className="button primary" to={`/gifts/${shipped.id}`}>
            查看物流
            <ArrowRight aria-hidden="true" size={16} />
          </Link>
        </section>
      ) : null}

      <section>
        <div className="section-heading">
          <div>
            <p className="eyebrow">礼物中心</p>
            <h2>我的礼物单</h2>
            <p>资格、领取和物流状态都集中在同一张礼物单中。</p>
          </div>
          <Link className="button ghost" to="/gifts">
            全部礼物
          </Link>
        </div>
        {gifts.isPending ? (
          <LoadingState label="正在读取礼物单…" />
        ) : gifts.isError ? (
          <ErrorState
            error={gifts.error}
            onRetry={() => void gifts.refetch()}
            retryLabel="重试礼物单"
            title="礼物单暂时无法加载"
          />
        ) : gifts.data.length === 0 ? (
          <EmptyState
            action={
              binding.data === null ? (
                <Link className="button secondary" to="/account/bilibili">
                  绑定 B站账号
                </Link>
              ) : null
            }
            description={
              binding.data
                ? '主播发布礼物并完成月末名单同步后，属于你的礼物会自动出现。'
                : binding.data === null
                  ? '完成 B站 UID 绑定后，系统会匹配现在和过去属于你的礼物。'
                  : '礼物单会在这里显示；B站绑定状态暂时无法读取。'
            }
            icon={Gift}
            title="目前没有礼物单"
          />
        ) : (
          <div className="gift-grid">
            {gifts.data.slice(0, 6).map((gift) => (
              <GiftCard key={gift.id} now={now} order={gift} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
