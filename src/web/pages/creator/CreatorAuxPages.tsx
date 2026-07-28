import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { getIdentity, updateCreatorProfile, type Identity } from '../../api/client';
import { AnnouncementManager } from '../../components/AnnouncementManager';
import { ErrorState, InlineNotice, LoadingState, PageHeader } from '../../components/Ui';

export function CreatorAnnouncementsPage() {
  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="CREATOR ANNOUNCEMENTS"
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
  const [displayName, setDisplayName] = useState(creator.displayName);
  const save = useMutation({
    mutationFn: () => updateCreatorProfile({ displayName }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['identity'] }),
  });
  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="CREATOR SETTINGS"
        intro="这里仅维护主播身份信息；名单来源配置由平台管理员管理。"
        title="主播设置"
      />
      <div className="settings-grid">
        <form
          className="panel settings-form"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <div className="section-heading compact">
            <div>
              <h2>公开身份</h2>
              <p>会显示在用户的礼物卡片和公告中。</p>
            </div>
          </div>
          <label>
            主播显示名称
            <input
              maxLength={120}
              onChange={(event) => setDisplayName(event.target.value)}
              required
              value={displayName}
            />
          </label>
          {save.isSuccess ? <InlineNotice tone="success">设置已保存。</InlineNotice> : null}
          {save.isError ? <InlineNotice tone="danger">{save.error.message}</InlineNotice> : null}
          <button className="button primary" disabled={save.isPending} type="submit">
            保存设置
          </button>
        </form>
        <section className="panel readonly-settings">
          <div className="section-heading compact">
            <div>
              <h2>名单来源</h2>
              <p>以下信息由平台管理员维护。</p>
            </div>
          </div>
          <dl>
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
              <dt>结算时区</dt>
              <dd>{creator.timezone}</dd>
            </div>
            <div>
              <dt>名单同步</dt>
              <dd>{creator.active ? '已启用' : '已停用'}</dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}
