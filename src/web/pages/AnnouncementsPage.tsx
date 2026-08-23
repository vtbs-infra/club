import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, ChevronDown } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

import { getAnnouncements, markAnnouncementRead, type Announcement } from '../api/client';
import {
  EmptyState,
  ErrorNotice,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '../components/Ui';
import { formatDate } from '../lib/format';
import { announcementSeverityPresentation } from '../lib/status-presentation';

export function AnnouncementsPage() {
  const queryClient = useQueryClient();
  const [parameters, setParameters] = useSearchParams();
  const openId = parameters.get('open');
  const handledOpenId = useRef<string | null>(null);
  const announcements = useQuery({
    queryFn: () => getAnnouncements(),
    queryKey: ['me', 'announcements'],
  });
  const {
    error: markReadError,
    isError: markReadFailed,
    mutate: markRead,
  } = useMutation({
    mutationFn: markAnnouncementRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['me', 'announcements'] }),
  });

  useEffect(() => {
    if (!openId) {
      handledOpenId.current = null;
      return;
    }
    if (!announcements.data || handledOpenId.current === openId) return;
    const announcement = announcements.data.find((item) => item.id === openId);
    if (!announcement) return;

    handledOpenId.current = openId;
    document.getElementById(`announcement-${openId}`)?.scrollIntoView({ block: 'center' });
    if (!announcement.read) markRead(announcement.id);
  }, [announcements.data, markRead, openId]);

  if (announcements.isPending) return <LoadingState label="正在读取公告…" />;
  if (announcements.isError) return <ErrorState error={announcements.error} />;
  const open = (announcement: Announcement) => {
    const nextOpenId = openId === announcement.id ? null : announcement.id;
    handledOpenId.current = nextOpenId;
    setParameters(
      (current) => {
        const next = new URLSearchParams(current);
        if (nextOpenId) next.set('open', nextOpenId);
        else next.delete('open');
        return next;
      },
      { replace: true },
    );
    if (nextOpenId && !announcement.read) markRead(announcement.id);
  };
  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="平台动态"
        intro="平台公告和与你的礼物相关的主播通知都会显示在这里。"
        title="公告"
      />
      {markReadFailed ? <ErrorNotice error={markReadError} /> : null}
      {announcements.data.length === 0 ? (
        <EmptyState description="有新消息时会显示在这里。" icon={Bell} title="暂无公告" />
      ) : (
        <div className="announcement-list">
          {announcements.data.map((announcement) => {
            const expanded = openId === announcement.id;
            const bodyId = `announcement-${announcement.id}-body`;
            return (
              <article
                className={expanded ? 'announcement-card open' : 'announcement-card'}
                id={`announcement-${announcement.id}`}
                key={announcement.id}
              >
                <button
                  aria-controls={bodyId}
                  aria-expanded={expanded}
                  onClick={() => open(announcement)}
                  type="button"
                >
                  <div>
                    <StatusBadge {...announcementSeverityPresentation[announcement.severity]} />
                    {announcement.pinned ? <span className="soft-tag">置顶</span> : null}
                    {!announcement.read ? <span className="unread-dot" aria-label="未读" /> : null}
                  </div>
                  <strong>{announcement.title}</strong>
                  <time dateTime={announcement.publishedAt ?? undefined}>
                    {announcement.publishedAt ? formatDate(announcement.publishedAt, true) : ''}
                  </time>
                  <ChevronDown aria-hidden="true" className="announcement-chevron" size={18} />
                </button>
                {expanded ? (
                  <div className="announcement-body" id={bodyId}>
                    {announcement.body.split('\n').map((paragraph, index) => (
                      <p key={index}>{paragraph || '\u00a0'}</p>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
