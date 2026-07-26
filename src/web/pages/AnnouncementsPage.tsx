import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { listMyAnnouncements, markAnnouncementRead, type Announcement } from '../api/announcements';
import { AuthenticatedPage } from '../components/AuthenticatedPage';

function AnnouncementCard({
  announcement,
  onRead,
}: {
  readonly announcement: Announcement;
  readonly onRead: (id: string) => void;
}) {
  return (
    <article
      className={`panel announcement-card severity-${announcement.severity.toLowerCase()} ${
        announcement.readAt ? '' : 'announcement-unread'
      }`}
    >
      <div className="title-row compact-title">
        <div>
          <div className="button-row">
            <span className="role-chip">{announcement.scope}</span>
            <span className="role-chip">{announcement.severity}</span>
            {announcement.pinned ? <span className="role-chip">PINNED</span> : null}
          </div>
          <h2>{announcement.title}</h2>
        </div>
        <span className="muted">
          {announcement.publishedAt ? new Date(announcement.publishedAt).toLocaleString() : 'Draft'}
        </span>
      </div>
      <p>{announcement.body}</p>
      {!announcement.readAt ? (
        <button
          className="button button-quiet"
          type="button"
          onClick={() => onRead(announcement.id)}
        >
          Mark read
        </button>
      ) : (
        <small className="muted">Read {new Date(announcement.readAt).toLocaleString()}</small>
      )}
    </article>
  );
}

export function AnnouncementsPage() {
  return <AuthenticatedPage>{() => <AnnouncementCenter />}</AuthenticatedPage>;
}

function AnnouncementCenter() {
  const queryClient = useQueryClient();
  const notices = useQuery({
    queryFn: listMyAnnouncements,
    queryKey: ['me', 'announcements'],
    refetchInterval: 15_000,
  });
  const read = useMutation({
    mutationFn: markAnnouncementRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['me', 'announcements'] }),
  });
  const unread = notices.data?.filter((item) => !item.readAt).length ?? 0;
  return (
    <section className="page-content">
      <p className="section-kicker">NOTICE CENTER</p>
      <div className="title-row">
        <div>
          <h1>Announcements.</h1>
          <p className="lede">
            Platform, organization, creator, and campaign notices in one place.
          </p>
        </div>
        <span className="role-chip">{unread} UNREAD</span>
      </div>
      {notices.isError ? (
        <p className="form-message form-error">Announcements could not be loaded.</p>
      ) : null}
      <div className="announcement-list">
        {notices.data?.map((item) => (
          <AnnouncementCard announcement={item} key={item.id} onRead={(id) => read.mutate(id)} />
        ))}
      </div>
      {notices.data?.length === 0 ? (
        <div className="panel empty-state">
          <h2>No announcements</h2>
          <p>New notices will appear here automatically.</p>
        </div>
      ) : null}
    </section>
  );
}
