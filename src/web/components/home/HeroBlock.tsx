import type { CSSProperties } from 'react';

import { assetUrl, blockClass, type HomeBlockProperties } from './types';

export function HeroBlock({ block, home, identity }: HomeBlockProperties<'hero'>) {
  const desktop = assetUrl(block.content.backgroundDesktopAssetId);
  const mobile = assetUrl(block.content.backgroundMobileAssetId);
  const background = assetUrl(block.style.backgroundAssetId);
  const style = {
    '--home-hero-desktop': desktop || background ? `url("${desktop ?? background}")` : 'none',
    '--home-hero-mobile':
      mobile || desktop || background ? `url("${mobile ?? desktop ?? background}")` : 'none',
    '--home-overlay': String(block.style.overlay ?? 0.36),
    '--home-position': block.style.backgroundPosition ?? 'center',
  } as CSSProperties;
  const greeting = identity
    ? home.user?.pendingGift
      ? `欢迎回来，${identity.user.name}。你有礼物等待领取。`
      : `欢迎回来，${identity.user.name}。`
    : '登录后确认你的领取资格';

  return (
    <section className={`${blockClass(block)} home-hero`} style={style}>
      <div className="home-block-inner home-hero-inner">
        {block.content.avatarAssetId ? (
          <img
            alt=""
            className="home-hero-avatar"
            height="112"
            src={assetUrl(block.content.avatarAssetId, true)}
            width="112"
          />
        ) : (
          <span className="home-hero-avatar home-hero-avatar-placeholder" aria-hidden="true">
            ✦
          </span>
        )}
        <p className="home-eyebrow">{block.content.eyebrow}</p>
        <h1>{block.content.title}</h1>
        <p className="home-hero-description">{block.content.description}</p>
        <p className="home-personal-greeting">{greeting}</p>
        <div className="home-actions">
          {block.content.primaryAction ? (
            <a className="button" href={block.content.primaryAction.href}>
              {block.content.primaryAction.label}
            </a>
          ) : null}
          {block.content.secondaryAction ? (
            <a className="button button-secondary" href={block.content.secondaryAction.href}>
              {block.content.secondaryAction.label}
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}
