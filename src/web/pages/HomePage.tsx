import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Bell,
  Check,
  CircleUserRound,
  Clock3,
  Gift,
  GitFork,
  Link2,
  LockKeyhole,
  MapPin,
  PackageCheck,
  ShieldCheck,
  Sparkles,
  Truck,
  UserRoundCheck,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { getIdentity } from '../api/client';
import { getPortalHome, type PortalRelease } from '../api/portal';
import { ProductBrand } from '../components/ProductBrand';
import { formatDate, formatMonth, relativeDeadline } from '../lib/format';

const processSteps = [
  {
    copy: '在平台指定直播间发送一次性验证码，完成 B站 UID 绑定。',
    icon: Link2,
    title: '绑定账号',
  },
  {
    copy: '名单和主播发布的礼物匹配后，礼物单会自动出现。',
    icon: Gift,
    title: '收到礼物单',
  },
  {
    copy: '选择地址并填写必要选项，确认本次礼物领取。',
    icon: MapPin,
    title: '提交领取',
  },
  {
    copy: '主播发货后，在同一张礼物单里查看物流进度。',
    icon: Truck,
    title: '等待收货',
  },
] as const;

function ReleaseCard({
  release,
  signedIn,
}: {
  readonly release: PortalRelease;
  readonly signedIn: boolean;
}) {
  return (
    <article className="portal-release-card">
      <div className="portal-release-cover">
        {release.coverImageUrl ? (
          <img alt={`${release.title}封面`} loading="lazy" src={release.coverImageUrl} />
        ) : (
          <div className="portal-release-placeholder" aria-hidden="true">
            <span className="placeholder-star placeholder-star-one">✦</span>
            <span className="placeholder-star placeholder-star-two">✦</span>
            <Gift size={58} strokeWidth={1.65} />
          </div>
        )}
        <span className="portal-release-status">
          <Clock3 aria-hidden="true" size={13} />
          领取中
        </span>
      </div>
      <div className="portal-release-copy">
        <div className="portal-release-creator">
          <CircleUserRound aria-hidden="true" size={16} />
          <span>{release.creatorName}</span>
        </div>
        <h3>{release.title}</h3>
        <p>{release.description || `${formatMonth(release.eligibilityMonth)}舰长礼物正在领取。`}</p>
        <dl className="portal-release-meta">
          <div>
            <dt>资格月份</dt>
            <dd>{formatMonth(release.eligibilityMonth)}</dd>
          </div>
          <div>
            <dt>领取截止</dt>
            <dd>{relativeDeadline(release.claimDeadlineAt)}</dd>
          </div>
        </dl>
        <Link className="portal-card-action" to={signedIn ? '/app' : '/login'}>
          {signedIn ? '进入工作台检查资格' : '登录检查我的资格'}
          <ArrowRight aria-hidden="true" size={16} />
        </Link>
      </div>
    </article>
  );
}

export function HomePage() {
  const identity = useQuery({
    queryFn: getIdentity,
    queryKey: ['identity'],
    retry: false,
  });
  const portal = useQuery({
    queryFn: getPortalHome,
    queryKey: ['portal-home'],
    retry: false,
    staleTime: 60_000,
  });

  const signedIn = identity.data !== undefined;
  const announcements = portal.data?.announcements ?? [];
  const featuredAnnouncement = announcements.find((announcement) => announcement.pinned);
  const recentAnnouncements = featuredAnnouncement
    ? announcements.filter((announcement) => announcement.id !== featuredAnnouncement.id)
    : announcements;

  return (
    <main className="public-page">
      <header className="portal-header">
        <div className="portal-header-inner">
          <ProductBrand className="portal-brand" />
          <nav className="portal-nav" aria-label="首页导航">
            <a href="#gifts">本期礼物</a>
            <a href="#news">近期资讯</a>
            <a href="#how">领取流程</a>
          </nav>
          <div className="portal-header-actions">
            {signedIn ? (
              <Link className="button small primary" to="/app">
                进入工作台
              </Link>
            ) : (
              <>
                <Link className="portal-login-link" to="/login">
                  登录
                </Link>
                <Link className="button small primary" to="/register">
                  注册
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="portal-hero">
        <div className="portal-hero-grid">
          <div className="portal-hero-copy">
            <p className="portal-kicker">
              <Sparkles aria-hidden="true" size={15} />
              开源舰长礼物平台
            </p>
            <h1 aria-label="属于你的舰长礼物，都在这里。">
              <span className="portal-hero-title-base">属于你的舰长礼物，</span>
              <span className="portal-hero-title-accent">都在这里。</span>
            </h1>
            <p className="portal-hero-intro">
              绑定你的 B站 UID，平台会自动匹配舰长礼物资格。从确认领取、填写地址到查询物流，
              每一步都清楚可见。
            </p>
            <div className="portal-hero-actions">
              <Link className="button primary large" to={signedIn ? '/app' : '/login'}>
                {signedIn ? '进入我的工作台' : '登录查看我的礼物'}
                <ArrowRight aria-hidden="true" size={17} />
              </Link>
              <a className="button ghost large" href="#how">
                了解领取流程
              </a>
            </div>
            <p className="portal-hero-note">
              <Check aria-hidden="true" size={15} />
              无需提供 B站密码，只需在指定直播间发送一次性验证码
            </p>
          </div>

          <div className="portal-hero-art" aria-hidden="true">
            <span className="portal-art-spark portal-art-spark-one">✦</span>
            <span className="portal-art-spark portal-art-spark-two">✦</span>
            <span className="portal-art-spark portal-art-spark-three">✦</span>
            <div className="portal-art-halo" />
            <div className="portal-gift-illustration">
              <div className="portal-gift-lid" />
              <div className="portal-gift-body">
                <Gift size={76} strokeWidth={1.55} />
              </div>
              <div className="portal-gift-ribbon" />
            </div>
            <div className="portal-art-card portal-art-card-match">
              <span className="portal-art-icon blue">
                <UserRoundCheck size={20} />
              </span>
              <span>
                <strong>资格已匹配</strong>
                <small>已关联 B站 UID</small>
              </span>
            </div>
            <div className="portal-art-card portal-art-card-shipping">
              <span className="portal-art-icon pink">
                <PackageCheck size={20} />
              </span>
              <span>
                <strong>发货进度可追踪</strong>
                <small>礼物状态实时可见</small>
              </span>
            </div>
          </div>
        </div>
      </section>

      {featuredAnnouncement ? (
        <aside className="portal-announcement-strip" aria-label="置顶公告">
          <div className="portal-announcement-strip-inner">
            <span className="portal-announcement-icon">
              <Bell aria-hidden="true" size={18} />
            </span>
            <span className="portal-announcement-label">置顶公告</span>
            <strong>{featuredAnnouncement.title}</strong>
            <p>{featuredAnnouncement.summary}</p>
            <time dateTime={featuredAnnouncement.publishedAt}>
              {formatDate(featuredAnnouncement.publishedAt)}
            </time>
          </div>
        </aside>
      ) : null}

      <section className="portal-section portal-gifts-section" id="gifts">
        <div className="portal-section-heading">
          <div>
            <p className="portal-kicker">本期礼物</p>
            <h2>正在开放领取</h2>
            <p>登录后即可检查自己是否拥有对应月份的领取资格。</p>
          </div>
          <Link className="portal-section-action" to={signedIn ? '/app' : '/login'}>
            {signedIn ? '进入工作台' : '查看我的礼物单'}
            <ArrowRight aria-hidden="true" size={16} />
          </Link>
        </div>

        {portal.isPending ? (
          <div className="portal-release-grid" aria-label="正在加载本期礼物">
            {[0, 1, 2].map((item) => (
              <div className="portal-release-skeleton" key={item} aria-hidden="true">
                <span />
                <i />
                <i />
              </div>
            ))}
          </div>
        ) : portal.isError ? (
          <div className="portal-empty-state" role="status">
            <Gift aria-hidden="true" size={30} />
            <div>
              <h3>礼物列表暂时无法加载</h3>
              <p>你仍可登录工作台查看自己的礼物单。</p>
            </div>
            <Link className="button ghost small" to={signedIn ? '/app' : '/login'}>
              {signedIn ? '进入工作台' : '前往登录'}
            </Link>
          </div>
        ) : portal.data.releases.length > 0 ? (
          <div className="portal-release-grid">
            {portal.data.releases.map((release) => (
              <ReleaseCard key={release.id} release={release} signedIn={signedIn} />
            ))}
          </div>
        ) : (
          <div className="portal-empty-state">
            <Gift aria-hidden="true" size={30} />
            <div>
              <h3>当前没有开放领取的礼物</h3>
              <p>主播发布新一期礼物后，会自动出现在这里。</p>
            </div>
          </div>
        )}
      </section>

      <section className="portal-section portal-overview-grid">
        <div className="portal-news-panel" id="news">
          <div className="portal-panel-heading">
            <p className="portal-kicker">平台动态</p>
            <h2>近期资讯</h2>
          </div>
          {portal.isPending ? (
            <div className="portal-news-skeleton" aria-label="正在加载近期资讯">
              <span />
              <span />
              <span />
            </div>
          ) : recentAnnouncements.length > 0 ? (
            <div className="portal-news-list">
              {recentAnnouncements.slice(0, 4).map((announcement) => (
                <article key={announcement.id}>
                  <div>
                    <span
                      className={`portal-news-type severity-${announcement.severity.toLowerCase()}`}
                    >
                      公告
                    </span>
                    <time dateTime={announcement.publishedAt}>
                      {formatDate(announcement.publishedAt)}
                    </time>
                  </div>
                  <h3>{announcement.title}</h3>
                  <p>{announcement.summary}</p>
                </article>
              ))}
            </div>
          ) : (
            <div className="portal-panel-empty">
              <Bell aria-hidden="true" size={24} />
              <p>近期没有新的平台资讯。</p>
            </div>
          )}
        </div>

        <div className="portal-process-panel" id="how">
          <div className="portal-panel-heading">
            <p className="portal-kicker">四步完成</p>
            <h2>礼物怎么领取？</h2>
          </div>
          <ol className="portal-process-list">
            {processSteps.map((step, index) => {
              const Icon = step.icon;
              return (
                <li key={step.title}>
                  <span className="portal-process-icon">
                    <Icon aria-hidden="true" size={21} />
                  </span>
                  <div>
                    <span className="portal-process-number">0{index + 1}</span>
                    <h3>{step.title}</h3>
                    <p>{step.copy}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      <section className="portal-trust" aria-label="服务说明">
        <div>
          <ShieldCheck aria-hidden="true" size={22} />
          <span>
            <strong>无需 B站密码</strong>
            <small>直播间验证码完成身份确认</small>
          </span>
        </div>
        <div>
          <LockKeyhole aria-hidden="true" size={22} />
          <span>
            <strong>收货信息加密保存</strong>
            <small>仅在礼物履约时按需使用</small>
          </span>
        </div>
        <div>
          <Truck aria-hidden="true" size={22} />
          <span>
            <strong>发货状态全程可查</strong>
            <small>从提交领取到最终签收</small>
          </span>
        </div>
      </section>

      <section className="portal-final-cta">
        <span className="portal-cta-decoration portal-cta-decoration-one" aria-hidden="true">
          ✦
        </span>
        <span className="portal-cta-decoration portal-cta-decoration-two" aria-hidden="true">
          ✦
        </span>
        <div>
          <p className="portal-kicker">{signedIn ? '欢迎回来' : '准备好了吗？'}</p>
          <h2>{signedIn ? '去工作台查看你的舰长礼物' : '别错过属于你的舰长礼物'}</h2>
          <p>
            {signedIn
              ? '你的礼物资格、领取记录和物流进度都集中在工作台。'
              : '创建账号并绑定 B站 UID，后续礼物资格会自动匹配到你的工作台。'}
          </p>
        </div>
        <div className="portal-final-actions">
          {signedIn ? (
            <Link className="button primary large" to="/app">
              进入工作台
              <ArrowRight aria-hidden="true" size={17} />
            </Link>
          ) : (
            <>
              <Link className="button primary large" to="/register">
                创建账号
                <ArrowRight aria-hidden="true" size={17} />
              </Link>
              <Link className="button ghost large" to="/login">
                已有账号，去登录
              </Link>
            </>
          )}
        </div>
      </section>

      <footer className="public-footer">
        <div>
          <ProductBrand className="portal-footer-brand" />
          <p>开源舰长礼物领取与发货平台</p>
        </div>
        <a
          className="portal-github-link"
          href="https://github.com/vtbs-infra/club"
          rel="noreferrer"
          target="_blank"
        >
          <GitFork aria-hidden="true" size={17} />
          GitHub
        </a>
      </footer>
    </main>
  );
}
