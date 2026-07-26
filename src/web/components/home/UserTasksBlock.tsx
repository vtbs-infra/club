import { blockClass, type HomeBlockProperties } from './types';

export function UserTasksBlock({ block, home }: HomeBlockProperties<'user_tasks'>) {
  const user = home.user;
  if (!user) return null;
  return (
    <section className={blockClass(block)}>
      <div className="home-block-inner">
        <div className="home-section-heading">
          <p className="home-eyebrow">为你整理</p>
          <h2>{block.content.title}</h2>
        </div>
        <div className="home-task-grid">
          <article className={`home-task-card ${user.pendingGift ? 'is-actionable' : ''}`}>
            <span className="home-task-icon" aria-hidden="true">
              礼
            </span>
            <p className="home-card-kicker">待领取礼物</p>
            <h3>{user.pendingGift?.title ?? '当前没有待领取礼物'}</h3>
            <p>
              {user.pendingGift
                ? `领取截止：${new Date(user.pendingGift.claimDeadlineAt).toLocaleString('zh-CN')}`
                : '新的资格匹配后会显示在这里。'}
            </p>
            {user.pendingGift ? (
              <a className="home-card-link" href={`/gifts/${user.pendingGift.campaignId}`}>
                立即领取 →
              </a>
            ) : null}
          </article>
          <article className={`home-task-card ${user.binding ? '' : 'is-actionable'}`}>
            <span className="home-task-icon" aria-hidden="true">
              UID
            </span>
            <p className="home-card-kicker">Bilibili 绑定</p>
            <h3>{user.binding ? `已绑定 ${user.binding.maskedUid}` : '尚未绑定 UID'}</h3>
            <p>
              {user.binding?.displayName
                ? `账号：${user.binding.displayName}`
                : user.binding
                  ? '绑定状态正常'
                  : '绑定后才能匹配历史舰长资格。'}
            </p>
            <a className="home-card-link" href="/account">
              {user.binding ? '管理绑定' : '立即绑定'} →
            </a>
          </article>
          <article className={`home-task-card ${user.addressReady ? '' : 'is-actionable'}`}>
            <span className="home-task-icon" aria-hidden="true">
              址
            </span>
            <p className="home-card-kicker">收货地址</p>
            <h3>{user.addressReady ? '默认收货信息已准备' : '尚未添加收货地址'}</h3>
            <p>{user.addressReady ? '领取时可以选择已保存地址。' : '领取礼物前请先完善地址。'}</p>
            <a className="home-card-link" href="/account">
              管理地址 →
            </a>
          </article>
          <article className="home-task-card">
            <span className="home-task-icon" aria-hidden="true">
              运
            </span>
            <p className="home-card-kicker">物流进度</p>
            <h3>{user.latestDelivery?.status ?? '暂无配送任务'}</h3>
            <p>{user.latestDelivery?.campaignTitle ?? '领取礼物后可在这里查看发放进度。'}</p>
            {user.latestDelivery ? (
              <a className="home-card-link" href={`/claims/${user.latestDelivery.claimId}`}>
                查看详情 →
              </a>
            ) : null}
          </article>
        </div>
      </div>
    </section>
  );
}
