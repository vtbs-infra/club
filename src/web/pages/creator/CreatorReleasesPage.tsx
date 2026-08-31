import { useInfiniteQuery } from '@tanstack/react-query';
import { ArrowRight, Gift, Info, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';

import { getCreatorReleases } from '../../api/client';
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '../../components/Ui';
import { formatDate, formatMonth } from '../../lib/format';
import { giftReleasePresentation } from '../../lib/status-presentation';

export function CreatorReleasesPage() {
  const releases = useInfiniteQuery({
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => getCreatorReleases({ cursor: pageParam }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    queryKey: ['creator', 'releases'],
  });
  if (releases.isPending) return <LoadingState label="正在读取礼物发布…" />;
  if (releases.isError) return <ErrorState error={releases.error} />;
  const items = releases.data.pages.flatMap((page) => page.items);
  return (
    <div className="stack-lg">
      <PageHeader
        actions={
          <Link className="button primary" to="/creator/releases/new">
            创建礼物发布
            <Plus aria-hidden="true" size={16} />
          </Link>
        }
        eyebrow="礼物管理"
        intro="只有你主动发布礼物时，系统才会根据对应月份名单生成礼物单。"
        title="礼物发布"
      />
      <div className="principle-note">
        <span>
          <Info aria-hidden="true" size={18} />
        </span>
        <p>
          <strong>不发礼物的月份无需任何操作。</strong>
          名单仍会按月冻结，但不会产生草稿、提醒或空礼物单。
        </p>
      </div>
      {items.length === 0 ? (
        <EmptyState
          action={
            <Link className="button primary" to="/creator/releases/new">
              创建第一份礼物发布
              <Plus aria-hidden="true" size={16} />
            </Link>
          }
          description="选择资格月份、配置三个等级的礼物内容，然后在准备好时发布。"
          icon={Gift}
          title="还没有礼物发布"
        />
      ) : (
        <div className="release-list">
          {items.map((release) => (
            <Link className="release-row" key={release.id} to={`/creator/releases/${release.id}`}>
              <div className="release-cover">
                {release.coverObjectKey ? (
                  <img alt="" src={`/api/v1/gift-releases/${release.id}/cover`} />
                ) : (
                  <Gift aria-hidden="true" size={28} strokeWidth={1.55} />
                )}
              </div>
              <div className="release-main">
                <span>
                  <StatusBadge {...giftReleasePresentation[release.status]} />
                  {release.publicVisible ? <span className="soft-tag">首页公开</span> : null}
                </span>
                <h3>{release.title}</h3>
                <p>{formatMonth(release.eligibilityMonth)}资格</p>
              </div>
              <div className="release-window">
                <small>领取期限</small>
                <strong>
                  {formatDate(release.claimStartAt)} — {formatDate(release.claimDeadlineAt)}
                </strong>
              </div>
              <span className="row-arrow">
                <ArrowRight aria-hidden="true" size={18} />
              </span>
            </Link>
          ))}
        </div>
      )}
      {releases.hasNextPage ? (
        <div className="list-actions">
          <button
            className="button secondary"
            disabled={releases.isFetchingNextPage}
            onClick={() => void releases.fetchNextPage()}
            type="button"
          >
            {releases.isFetchingNextPage ? '正在加载…' : '加载更早的礼物发布'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
