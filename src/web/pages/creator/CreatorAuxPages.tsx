import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getIdentity, refreshCreatorProfile, type Identity } from '../../api/client';
import { AnnouncementManager } from '../../components/AnnouncementManager';
import {
  ErrorNotice,
  ErrorState,
  InlineNotice,
  LoadingState,
  PageHeader,
} from '../../components/Ui';
import { formatDate } from '../../lib/format';

export function CreatorAnnouncementsPage() {
  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="主播公告"
        intro="这些公告会展示给拥有你礼物单的用户。"
        title="主播公告"
      />
      <AnnouncementManager area="creator" />
    </div>
  );
}

export function CreatorSettingsPage() {
  const identity = useQuery({ queryFn: getIdentity, queryKey: ['identity'] });
  if (identity.isPending) return <LoadingState />;
  if (identity.isError || !identity.data?.creator) return <ErrorState error={identity.error} />;
  return <CreatorSettingsForm creator={identity.data.creator} />;
}

function CreatorSettingsForm({ creator }: { readonly creator: NonNullable<Identity['creator']> }) {
  const queryClient = useQueryClient();
  const refresh = useMutation({
    mutationFn: refreshCreatorProfile,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['identity'] });
    },
  });
  return (
    <div className="stack-lg">
      <PageHeader
        actions={
          <button
            className="button secondary"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
            type="button"
          >
            {refresh.isPending ? '正在刷新…' : '刷新 B站资料'}
          </button>
        }
        eyebrow="主播设置"
        intro="主播身份来自已验证的 B站账号；名单结算设置由平台管理员管理。"
        title="主播设置"
      />
      <div className="settings-grid">
        <section className="panel readonly-settings">
          <div className="section-heading compact">
            <div>
              <h2>B站身份</h2>
              <p>昵称和直播间由平台从 B站读取，不支持手动覆盖。</p>
            </div>
          </div>
          <dl>
            <div>
              <dt>主播名称</dt>
              <dd>{creator.displayName}</dd>
            </div>
            <div>
              <dt>B站 UID</dt>
              <dd>{creator.bilibiliUid}</dd>
            </div>
            <div>
              <dt>直播间</dt>
              <dd>
                <a
                  href={`https://live.bilibili.com/${creator.roomId}`}
                  rel="noreferrer"
                  target="_blank"
                >
                  {creator.roomId} ↗
                </a>
              </dd>
            </div>
            <div>
              <dt>最近同步</dt>
              <dd>{formatDate(creator.profileSyncedAt, true)}</dd>
            </div>
          </dl>
          {refresh.isSuccess ? <InlineNotice tone="success">B站资料已刷新。</InlineNotice> : null}
          {refresh.isError ? <ErrorNotice error={refresh.error} /> : null}
        </section>
        <section className="panel readonly-settings">
          <div className="section-heading compact">
            <div>
              <h2>名单来源</h2>
              <p>以下信息只影响未来的月度名单任务。</p>
            </div>
          </div>
          <dl>
            <div>
              <dt>结算时区</dt>
              <dd>{creator.timezone}</dd>
            </div>
            <div>
              <dt>名单同步</dt>
              <dd>{creator.monthlySyncEnabled ? '同步开启' : '同步暂停'}</dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}
