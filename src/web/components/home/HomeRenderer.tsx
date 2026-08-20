import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';

import type {
  SiteAction,
  SiteBlock,
  SiteBlockStyle,
  SiteHomeResponse,
} from '../../../shared/site-content';
import { LanguageSwitch } from '../../i18n/LanguageSwitch';
import { useI18n } from '../../i18n/context';
import { formatDate, formatMonth } from '../../lib/format';

function assetUrl(assetId: string | undefined): string | undefined {
  return assetId ? `/api/v1/site-assets/${assetId}` : undefined;
}

function ActionLink({
  action,
  className,
}: {
  readonly action: SiteAction;
  readonly className: string;
}) {
  if (action.href.startsWith('/')) {
    return (
      <Link className={className} to={action.href}>
        {action.label}
      </Link>
    );
  }
  const external = /^https?:\/\//.test(action.href);
  return (
    <a
      className={className}
      href={action.href}
      {...(external ? { rel: 'noreferrer', target: '_blank' } : {})}
    >
      {action.label}
    </a>
  );
}

function blockClass(block: SiteBlock): string {
  return [
    'home-block',
    `home-block-${block.type}`,
    `block-variant-${block.themeVariant}`,
    `block-background-${block.style.background ?? 'default'}`,
    `block-padding-${block.style.padding ?? 'normal'}`,
    `block-align-${block.style.align ?? 'left'}`,
    `block-tone-${block.style.textTone ?? 'auto'}`,
  ].join(' ');
}

function blockStyle(style: SiteBlockStyle): CSSProperties {
  const background = assetUrl(style.backgroundAssetId);
  return {
    ...(background ? { backgroundImage: `url("${background}")` } : {}),
    ...(style.backgroundPosition ? { backgroundPosition: style.backgroundPosition } : {}),
    '--block-overlay': String(style.overlay ?? 0),
  } as CSSProperties;
}

function BlockFrame({
  block,
  children,
}: {
  readonly block: SiteBlock;
  readonly children: ReactNode;
}) {
  return (
    <section className={blockClass(block)} id={block.id} style={blockStyle(block.style)}>
      <div className={`home-block-inner width-${block.style.maxWidth ?? 'wide'}`}>{children}</div>
    </section>
  );
}

type JourneyIconKind = 'address' | 'delivery' | 'gift' | 'identity' | 'link' | 'route' | 'shield';

function JourneyIcon({ kind }: { readonly kind: JourneyIconKind }) {
  const paths: Record<JourneyIconKind, ReactNode> = {
    address: (
      <>
        <path d="M5 5.5h14v15H5zM8 3.5h8v4H8zM8.5 12h7M8.5 16h4.5" />
      </>
    ),
    delivery: (
      <>
        <path d="M3.5 7h11v10h-11zM14.5 10h3l3 3v4h-6z" />
        <circle cx="7" cy="18" r="2" />
        <circle cx="17.5" cy="18" r="2" />
      </>
    ),
    gift: (
      <>
        <path d="M4 9h16v11H4zM3 6h18v4H3zM12 6v14M12 6H8.7a2.2 2.2 0 1 1 2.2-2.2C10.9 5 12 6 12 6Zm0 0h3.3a2.2 2.2 0 1 0-2.2-2.2C13.1 5 12 6 12 6Z" />
      </>
    ),
    identity: (
      <>
        <rect height="15" rx="2" width="18" x="3" y="5" />
        <circle cx="8.5" cy="11" r="2" />
        <path d="M5.5 16c.7-1.5 1.7-2.2 3-2.2s2.4.7 3 2.2M14 10h4M14 14h4" />
      </>
    ),
    link: (
      <>
        <path d="m9 15 6-6M7.5 17.5l-1 1a3.5 3.5 0 0 1-5-5l4-4a3.5 3.5 0 0 1 5 0M16.5 6.5l1-1a3.5 3.5 0 0 1 5 5l-4 4a3.5 3.5 0 0 1-5 0" />
      </>
    ),
    route: (
      <>
        <circle cx="6" cy="18" r="2" />
        <circle cx="18" cy="6" r="2" />
        <path d="M8 18h3a3 3 0 0 0 3-3V9a3 3 0 0 1 3-3" />
      </>
    ),
    shield: (
      <>
        <path d="M12 3 20 6v5c0 5-3.2 8.3-8 10-4.8-1.7-8-5-8-10V6z" />
        <path d="m8.5 12 2.2 2.2 4.8-5" />
      </>
    ),
  };

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      {paths[kind]}
    </svg>
  );
}

function Hero({ block, home }: { readonly block: SiteBlock; readonly home: SiteHomeResponse }) {
  if (block.type !== 'hero') return null;
  const signedIn = home.user !== null;
  const titlePrefix = '欢迎来到';
  const titleRemainder = block.content.title.startsWith(titlePrefix)
    ? block.content.title.slice(titlePrefix.length).trim()
    : null;
  const desktop = assetUrl(block.content.backgroundDesktopAssetId);
  const mobile = assetUrl(block.content.backgroundMobileAssetId);
  const style = {
    '--hero-desktop': desktop ? `url("${desktop}")` : 'none',
    '--hero-mobile': mobile ? `url("${mobile}")` : desktop ? `url("${desktop}")` : 'none',
    '--block-overlay': String(block.style.overlay ?? 0.36),
    backgroundPosition: block.style.backgroundPosition ?? 'center',
  } as CSSProperties;
  const primary = block.content.primaryAction
    ? {
        ...block.content.primaryAction,
        href:
          signedIn && block.content.primaryAction.href === '/register'
            ? '/app'
            : block.content.primaryAction.href,
        label:
          signedIn && block.content.primaryAction.href === '/register'
            ? '进入我的工作台'
            : block.content.primaryAction.label,
      }
    : null;
  return (
    <section className={blockClass(block)} id={block.id} style={style}>
      <div className={`home-block-inner home-hero-inner width-${block.style.maxWidth ?? 'wide'}`}>
        <div className="home-hero-copy">
          {block.content.avatarAssetId ? (
            <img
              alt=""
              className="home-hero-avatar"
              height={112}
              src={assetUrl(block.content.avatarAssetId)}
              width={112}
            />
          ) : null}
          <p className="eyebrow">{block.content.eyebrow}</p>
          <h1 aria-label={block.content.title}>
            {titleRemainder ? (
              <>
                {titlePrefix}
                <br />
                {titleRemainder}
              </>
            ) : (
              block.content.title
            )}
          </h1>
          <p>{block.content.description}</p>
          <div className="home-actions">
            {primary ? <ActionLink action={primary} className="button primary large" /> : null}
            {block.content.secondaryAction ? (
              <ActionLink action={block.content.secondaryAction} className="button ghost large" />
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function UserTasks({
  block,
  home,
}: {
  readonly block: SiteBlock;
  readonly home: SiteHomeResponse;
}) {
  const { t } = useI18n();
  if (block.type !== 'user_tasks' || !home.user) return null;
  const user = home.user;
  return (
    <BlockFrame block={block}>
      <div className="home-section-heading">
        <p className="eyebrow">FOR YOU</p>
        <h2>{block.content.title}</h2>
      </div>
      <div className="home-task-grid">
        <article className={user.pendingGift ? 'is-attention' : ''}>
          <span aria-hidden="true">✦</span>
          <div>
            <small>{t('待领取礼物', 'Gift ready to claim')}</small>
            <strong>{user.pendingGift?.title ?? t('暂无待领取礼物', 'Nothing to claim')}</strong>
            <p>
              {user.pendingGift
                ? `${t('截止', 'Due')} ${formatDate(user.pendingGift.claimDeadlineAt, true)}`
                : t('新的礼物会自动显示在这里。', 'New gifts will appear here automatically.')}
            </p>
          </div>
          <Link to={user.pendingGift ? `/gifts/${user.pendingGift.orderId}` : '/gifts'}>
            {user.pendingGift ? t('立即领取', 'Claim now') : t('查看礼物', 'View gifts')} →
          </Link>
        </article>
        <article>
          <span aria-hidden="true">◎</span>
          <div>
            <small>{t('B站绑定', 'Bilibili binding')}</small>
            <strong>
              {user.binding
                ? (user.binding.displayName ?? `UID ${user.binding.maskedUid}`)
                : t('尚未绑定 UID', 'UID not connected')}
            </strong>
            <p>
              {user.binding
                ? `UID ${user.binding.maskedUid}`
                : t('绑定后才能自动匹配礼物资格。', 'Connect your UID to match gift eligibility.')}
            </p>
          </div>
          <Link to="/account/bilibili">{t('管理绑定', 'Manage binding')} →</Link>
        </article>
        <article>
          <span aria-hidden="true">⌂</span>
          <div>
            <small>{t('收货地址', 'Delivery address')}</small>
            <strong>
              {user.addressReady
                ? t('默认收货信息已准备', 'Delivery details ready')
                : t('尚未添加收货地址', 'No delivery address')}
            </strong>
            <p>
              {user.addressReady
                ? t('领取时可以选择已保存地址。', 'Choose a saved address when claiming.')
                : t('领取礼物前请先完善地址。', 'Add an address before claiming.')}
            </p>
          </div>
          <Link to="/account/addresses">{t('管理地址', 'Manage addresses')} →</Link>
        </article>
        <article>
          <span aria-hidden="true">➜</span>
          <div>
            <small>{t('物流进度', 'Shipment progress')}</small>
            <strong>{user.latestDelivery?.title ?? t('暂无配送任务', 'No delivery task')}</strong>
            <p>
              {user.latestDelivery
                ? user.latestDelivery.status
                : t(
                    '领取礼物后可在这里查看发放进度。',
                    'Shipment progress appears after claiming.',
                  )}
            </p>
          </div>
          <Link to={user.latestDelivery ? `/gifts/${user.latestDelivery.orderId}` : '/gifts'}>
            {t('查看详情', 'View details')} →
          </Link>
        </article>
      </div>
    </BlockFrame>
  );
}

function ActiveCampaign({
  block,
  home,
}: {
  readonly block: SiteBlock;
  readonly home: SiteHomeResponse;
}) {
  const { t } = useI18n();
  if (block.type !== 'active_campaign') return null;
  return (
    <BlockFrame block={block}>
      <div className="home-section-heading">
        <p className="eyebrow">CURRENT GIFTS</p>
        <h2>{block.content.title}</h2>
      </div>
      {home.campaigns.length === 0 ? (
        <p className="home-calm-empty">{block.content.emptyText}</p>
      ) : (
        <div className="home-campaign-grid">
          {home.campaigns.map((campaign) => (
            <article className="home-campaign-card" key={campaign.id}>
              <div
                className={campaign.coverImageUrl ? 'campaign-cover has-image' : 'campaign-cover'}
                style={
                  campaign.coverImageUrl
                    ? { backgroundImage: `url("${campaign.coverImageUrl}")` }
                    : undefined
                }
              >
                <span>{formatMonth(campaign.eligibilityMonth)}</span>
              </div>
              <div>
                <p className="eyebrow">{campaign.creatorName}</p>
                <h3>{campaign.title}</h3>
                <p>{campaign.description}</p>
                <dl>
                  <div>
                    <dt>{t('领取截止', 'Claim by')}</dt>
                    <dd>{formatDate(campaign.claimDeadlineAt, true)}</dd>
                  </div>
                  <div>
                    <dt>{t('适用等级', 'Eligible tiers')}</dt>
                    <dd>{t('舰长 / 提督 / 总督', 'Captain / Admiral / Governor')}</dd>
                  </div>
                </dl>
                <Link className="button secondary" to="/app">
                  {t('查看礼物详情', 'View gift details')}
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </BlockFrame>
  );
}

function TrustSection() {
  const { t } = useI18n();
  const items: ReadonlyArray<{
    readonly description: string;
    readonly icon: JourneyIconKind;
    readonly title: string;
  }> = [
    {
      description: t(
        '通过固定验证直播间完成 UID 认证，无需填写 B站账号密码。',
        'Verify your UID through the assigned live room without sharing a Bilibili password.',
      ),
      icon: 'link',
      title: t('直播间安全直连', 'Secure live-room verification'),
    },
    {
      description: t(
        '手机号与收货地址加密封存，仅在授权发货流程中使用。',
        'Phone numbers and addresses stay encrypted until authorized fulfillment.',
      ),
      icon: 'shield',
      title: t('收货信息加密保护', 'Encrypted delivery details'),
    },
    {
      description: t(
        '发货后同步快递单号与关键运输节点，进度随时可查。',
        'Shipment numbers and key delivery events remain available in one place.',
      ),
      icon: 'route',
      title: t('物流状态持续同步', 'Continuous shipment updates'),
    },
  ];

  return (
    <section className="home-trust-block">
      <div className="home-trust-inner">
        <div className="home-trust-heading">
          <div>
            <p className="eyebrow">SECURITY &amp; PRIVACY</p>
            <h2>{t('安心填写，只为准确送达', 'Private by design, reliable by default')}</h2>
          </div>
          <p>
            {t(
              '从身份验证到物流签收，每一个环节都有清晰的安全边界。',
              'Clear privacy safeguards cover every step from verification to delivery.',
            )}
          </p>
        </div>
        <div className="home-trust-grid">
          {items.map((item) => (
            <article key={item.title}>
              <span className="home-trust-icon">
                <JourneyIcon kind={item.icon} />
              </span>
              <div>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function ContentBlock({
  block,
  home,
}: {
  readonly block: SiteBlock;
  readonly home: SiteHomeResponse;
}) {
  const { t } = useI18n();
  switch (block.type) {
    case 'image_text':
      return (
        <BlockFrame block={block}>
          <div className={`home-image-text layout-${block.content.layout}`}>
            <div className="home-content-image">
              {block.content.assetId ? (
                <img alt="" loading="lazy" src={assetUrl(block.content.assetId)} />
              ) : (
                <span aria-hidden="true">✦</span>
              )}
            </div>
            <div>
              <p className="eyebrow">{block.content.eyebrow}</p>
              <h2>{block.content.title}</h2>
              <p>{block.content.body}</p>
            </div>
          </div>
        </BlockFrame>
      );
    case 'rich_text':
      return (
        <BlockFrame block={block}>
          <div className="home-rich-text">
            <h2>{block.content.title}</h2>
            {block.content.paragraphs.map((paragraph, index) => (
              <p key={`${block.id}-${index}`}>{paragraph}</p>
            ))}
            <div className="home-actions">
              {block.content.actions.map((action) => (
                <ActionLink action={action} className="button secondary" key={action.href} />
              ))}
            </div>
          </div>
        </BlockFrame>
      );
    case 'announcement_list':
      return (
        <BlockFrame block={block}>
          <div className="home-section-heading">
            <p className="eyebrow">LATEST NEWS</p>
            <h2>{block.content.title}</h2>
          </div>
          {home.announcements.length === 0 ? (
            <p className="home-calm-empty">
              {t('暂时没有新公告。', 'There are no new announcements.')}
            </p>
          ) : (
            <div className="home-announcement-list">
              {home.announcements.slice(0, block.content.limit).map((announcement) => (
                <Link key={announcement.id} to="/announcements">
                  <span className={`announcement-severity severity-${announcement.severity}`}>
                    {announcement.pinned ? t('置顶', 'Pinned') : announcement.severity}
                  </span>
                  <span>
                    <strong>{announcement.title}</strong>
                    <small>{announcement.body.slice(0, 100)}</small>
                  </span>
                  <time>{formatDate(announcement.publishedAt)}</time>
                </Link>
              ))}
            </div>
          )}
        </BlockFrame>
      );
    case 'process_steps':
      return (
        <>
          <BlockFrame block={block}>
            <div className="home-section-heading home-process-heading">
              <div>
                <p className="eyebrow">HOW IT WORKS</p>
                <h2>{block.content.title}</h2>
              </div>
              <p>
                {t(
                  '绑定 UID → 自动核验资格 → 填写地址 → 静候礼物送达',
                  'Connect UID → Verify eligibility → Add address → Receive your gift',
                )}
              </p>
            </div>
            <ol className="home-process-grid">
              {block.content.steps.map((step, index) => {
                const icons: readonly JourneyIconKind[] = [
                  'identity',
                  'address',
                  'gift',
                  'delivery',
                ];
                return (
                  <li key={`${block.id}-${index}`}>
                    <span className="home-process-icon">
                      <JourneyIcon kind={icons[index % icons.length]!} />
                    </span>
                    <small>{String(index + 1).padStart(2, '0')}</small>
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </li>
                );
              })}
            </ol>
          </BlockFrame>
          <TrustSection />
        </>
      );
    case 'image_banner':
      return (
        <BlockFrame block={block}>
          <div
            className={block.content.assetId ? 'home-image-banner has-image' : 'home-image-banner'}
            style={
              block.content.assetId
                ? { backgroundImage: `url("${assetUrl(block.content.assetId)}")` }
                : undefined
            }
          >
            <div>
              <h2>{block.content.title}</h2>
              <p>{block.content.description}</p>
            </div>
            {block.content.action ? (
              <ActionLink action={block.content.action} className="button light" />
            ) : null}
          </div>
        </BlockFrame>
      );
    case 'card_group':
      return (
        <BlockFrame block={block}>
          <div className="home-section-heading">
            <h2>{block.content.title}</h2>
          </div>
          <div className="home-card-group">
            {block.content.cards.map((card, index) => (
              <article key={`${block.id}-${index}`}>
                <span aria-hidden="true">0{index + 1}</span>
                <h3>{card.title}</h3>
                <p>{card.description}</p>
                {card.href ? (
                  <ActionLink
                    action={{ href: card.href, label: t('了解更多 →', 'Learn more →') }}
                    className="text-action"
                  />
                ) : null}
              </article>
            ))}
          </div>
        </BlockFrame>
      );
    case 'gallery':
      return (
        <BlockFrame block={block}>
          <div className="home-section-heading">
            <h2>{block.content.title}</h2>
          </div>
          <div className="home-gallery">
            {block.content.items.map((item) => (
              <figure key={item.assetId}>
                <img alt={item.caption} loading="lazy" src={assetUrl(item.assetId)} />
                {item.caption ? <figcaption>{item.caption}</figcaption> : null}
              </figure>
            ))}
          </div>
        </BlockFrame>
      );
    case 'cta':
      return (
        <BlockFrame block={block}>
          <div className="home-cta">
            <div>
              <h2>{block.content.title}</h2>
              <p>{block.content.description}</p>
            </div>
            <div className="home-actions">
              <ActionLink action={block.content.action} className="button light large" />
              {block.content.secondaryAction ? (
                <ActionLink action={block.content.secondaryAction} className="button ghost large" />
              ) : null}
            </div>
          </div>
        </BlockFrame>
      );
    case 'divider':
      return (
        <BlockFrame block={block}>
          <div className="home-divider">
            <span>{block.content.label}</span>
          </div>
        </BlockFrame>
      );
    default:
      return null;
  }
}

function visible(block: SiteBlock, signedIn: boolean): boolean {
  if (!block.enabled) return false;
  if (block.audience === 'anonymous') return !signedIn;
  if (block.audience === 'authenticated') return signedIn;
  return true;
}

export function HomeRenderer({
  home,
  preview = false,
}: {
  readonly home: SiteHomeResponse;
  readonly preview?: boolean;
}) {
  const signedIn = home.user !== null;
  const { t } = useI18n();
  return (
    <main className={preview ? 'fan-portal is-preview' : 'fan-portal'}>
      <header className="portal-header">
        <Link className="brand" to="/">
          <span className="brand-mark">✦</span>
          <span>{home.content.site.name}</span>
        </Link>
        <nav aria-label={t('首页导航', 'Homepage navigation')}>
          <Link className="is-active" to="/">
            {t('首页', 'Home')}
          </Link>
          <Link to={signedIn ? '/gifts' : '/login'}>{t('我的礼物', 'My gifts')}</Link>
          <a href="#claim-process">{t('常见问题', 'How it works')}</a>
          <a href="https://www.bilibili.com/" rel="noreferrer" target="_blank">
            {t('Bilibili 官网', 'Bilibili')}
          </a>
          <LanguageSwitch compact />
          {signedIn ? (
            <Link className="button small primary" to="/app">
              {t('进入工作台', 'Open workspace')}
            </Link>
          ) : (
            <>
              <Link to="/login">{t('登录', 'Sign in')}</Link>
              <Link className="button small primary" to="/register">
                {t('注册', 'Register')}
              </Link>
            </>
          )}
        </nav>
      </header>
      {home.content.blocks
        .filter((block) => visible(block, signedIn))
        .map((block) => {
          if (block.type === 'hero') return <Hero block={block} home={home} key={block.id} />;
          if (block.type === 'user_tasks') {
            return <UserTasks block={block} home={home} key={block.id} />;
          }
          if (block.type === 'active_campaign') {
            return <ActiveCampaign block={block} home={home} key={block.id} />;
          }
          return <ContentBlock block={block} home={home} key={block.id} />;
        })}
      <footer className="portal-footer">
        <div>
          <strong>{home.content.site.name}</strong>
          <span>{home.content.site.tagline}</span>
        </div>
        <div>
          <Link to="/">{t('隐私说明', 'Privacy')}</Link>
          <Link to="/">{t('使用帮助', 'Help')}</Link>
          <Link to="/login">{t('联系管理员', 'Contact admin')}</Link>
        </div>
        <small>{home.content.site.footerText}</small>
      </footer>
      {!preview ? (
        <nav aria-label={t('移动端导航', 'Mobile navigation')} className="portal-mobile-nav">
          <Link to="/">
            ⌂<span>{t('首页', 'Home')}</span>
          </Link>
          <Link to={signedIn ? '/gifts' : '/login'}>
            ✦<span>{t('礼物', 'Gifts')}</span>
          </Link>
          <Link to={signedIn ? '/account' : '/login'}>
            ◎<span>{t('我的', 'Me')}</span>
          </Link>
        </nav>
      ) : null}
    </main>
  );
}
