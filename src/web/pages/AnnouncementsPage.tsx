import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { getAnnouncements, markAnnouncementRead, type Announcement } from '../api/client';
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '../components/Ui';
import { formatDate } from '../lib/format';

export function AnnouncementsPage() {
  const queryClient = useQueryClient();
  const announcements = useQuery({
    queryFn: () => getAnnouncements(),
    queryKey: ['me', 'announcements'],
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const markRead = useMutation({
    mutationFn: markAnnouncementRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['me', 'announcements'] }),
  });
  if (announcements.isPending) return <LoadingState label="正在读取公告…" />;
  if (announcements.isError) return <ErrorState error={announcements.error} />;
  const open = (announcement: Announcement) => {
    setOpenId((current) => (current === announcement.id ? null : announcement.id));
    if (!announcement.read) markRead.mutate(announcement.id);
  };
  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="ANNOUNCEMENTS"
        intro="平台公告和与你的礼物相关的主播通知都会显示在这里。"
        title="公告"
      />
      {announcements.data.length === 0 ? (
        <EmptyState description="有新消息时会显示在这里。" title="暂无公告" />
      ) : (
        <div className="announcement-list">
          {announcements.data.map((announcement) => (
            <article
              className={
                openId === announcement.id ? 'announcement-card open' : 'announcement-card'
              }
              key={announcement.id}
            >
              <button onClick={() => open(announcement)} type="button">
                <div>
                  <StatusBadge status={announcement.severity}>
                    {announcement.severity === 'INFO'
                      ? '公告'
                      : announcement.severity === 'WARNING'
                        ? '重要'
                        : '紧急'}
                  </StatusBadge>
                  {announcement.pinned ? <span className="soft-tag">置顶</span> : null}
                  {!announcement.read ? <span className="unread-dot" aria-label="未读" /> : null}
                </div>
                <strong>{announcement.title}</strong>
                <time>
                  {announcement.publishedAt ? formatDate(announcement.publishedAt, true) : ''}
                </time>
                <span aria-hidden="true">{openId === announcement.id ? '−' : '+'}</span>
              </button>
              {openId === announcement.id ? (
                <div className="announcement-body">
                  {announcement.body.split('\n').map((paragraph, index) => (
                    <p key={index}>{paragraph || '\u00a0'}</p>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
