import { blockClass, type HomeBlockProperties } from './types';

export function AnnouncementListBlock({ block, home }: HomeBlockProperties<'announcement_list'>) {
  const announcements = home.announcements.slice(0, block.content.limit);
  return (
    <section className={blockClass(block)}>
      <div className="home-block-inner">
        <div className="home-section-heading home-section-heading-row">
          <div>
            <p className="home-eyebrow">请及时查看</p>
            <h2>{block.content.title}</h2>
          </div>
          <a href="/announcements">查看全部 →</a>
        </div>
        {announcements.length ? (
          <div className="home-announcement-list">
            {announcements.map((announcement) => (
              <article key={announcement.id}>
                <span
                  className={`home-notice-severity severity-${announcement.severity.toLowerCase()}`}
                >
                  {announcement.pinned ? '置顶' : announcement.severity}
                </span>
                <h3>{announcement.title}</h3>
                <time dateTime={announcement.publishedAt}>
                  {new Date(announcement.publishedAt).toLocaleDateString('zh-CN')}
                </time>
              </article>
            ))}
          </div>
        ) : (
          <div className="home-empty-state">暂时没有新公告。</div>
        )}
      </div>
    </section>
  );
}
