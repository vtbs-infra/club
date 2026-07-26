import { blockClass, type HomeBlockProperties } from './types';

export function ActiveCampaignBlock({
  block,
  home,
  identity,
}: HomeBlockProperties<'active_campaign'>) {
  return (
    <section className={blockClass(block)}>
      <div className="home-block-inner">
        <div className="home-section-heading">
          <p className="home-eyebrow">本期限定</p>
          <h2>{block.content.title}</h2>
        </div>
        {home.campaigns.length ? (
          <div className="home-campaign-grid">
            {home.campaigns.map((campaign, index) => (
              <article className="home-campaign-card" key={campaign.id}>
                <div className="home-campaign-art" aria-hidden="true">
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <strong>GIFT</strong>
                </div>
                <div className="home-campaign-copy">
                  <p className="home-card-kicker">{campaign.creatorName}</p>
                  <h3>{campaign.title}</h3>
                  <p>{campaign.description || '主播为舰长准备的限定礼物。'}</p>
                  <dl className="home-campaign-meta">
                    <div>
                      <dt>活动月份</dt>
                      <dd>{campaign.periodStart}</dd>
                    </div>
                    <div>
                      <dt>领取截止</dt>
                      <dd>{new Date(campaign.claimDeadlineAt).toLocaleString('zh-CN')}</dd>
                    </div>
                  </dl>
                  <a className="button" href={identity ? `/gifts/${campaign.id}` : '/login'}>
                    {identity ? '查看礼物详情' : '登录确认资格'}
                  </a>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="home-empty-state">{block.content.emptyText}</div>
        )}
      </div>
    </section>
  );
}
