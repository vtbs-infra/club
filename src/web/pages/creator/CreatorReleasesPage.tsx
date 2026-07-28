import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { getCreatorReleases } from '../../api/client';
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '../../components/Ui';
import { formatDate, formatMonth } from '../../lib/format';

export function CreatorReleasesPage() {
  const releases = useQuery({
    queryFn: getCreatorReleases,
    queryKey: ['creator', 'releases'],
  });
  if (releases.isPending) return <LoadingState label="正在读取礼物发布…" />;
  if (releases.isError) return <ErrorState error={releases.error} />;
  return (
    <div className="stack-lg">
      <PageHeader
        actions={
          <Link className="button primary" to="/creator/releases/new">
            创建礼物发布
          </Link>
        }
        eyebrow="GIFT RELEASES"
        intro="只有你主动发布礼物时，系统才会根据对应月份名单生成礼物单。"
        title="礼物发布"
      />
      <div className="principle-note">
        <span>i</span>
        <p>
          <strong>不发礼物的月份无需任何操作。</strong>
          名单仍会按月冻结，但不会产生草稿、提醒或空礼物单。
        </p>
      </div>
      {releases.data.length === 0 ? (
        <EmptyState
          action={
            <Link className="button primary" to="/creator/releases/new">
              创建第一份礼物发布
            </Link>
          }
          description="选择资格月份、配置三个等级的礼物内容，然后在准备好时发布。"
          title="还没有礼物发布"
        />
      ) : (
        <div className="release-list">
          {releases.data.map((release) => (
            <Link className="release-row" key={release.id} to={`/creator/releases/${release.id}`}>
              <div className="release-cover">
                {release.coverObjectKey ? (
                  <img alt="" src={`/api/v1/gift-releases/${release.id}/cover`} />
                ) : (
                  <span>✦</span>
                )}
              </div>
              <div className="release-main">
                <span>
                  <StatusBadge status={release.status}>
                    {release.status === 'DRAFT'
                      ? '草稿'
                      : release.status === 'PUBLISHED'
                        ? '已发布'
                        : '已关闭'}
                  </StatusBadge>
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
              <span className="row-arrow">→</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
