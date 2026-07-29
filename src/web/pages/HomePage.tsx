import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { getIdentity } from '../api/client';

export function HomePage() {
  const identity = useQuery({
    queryFn: getIdentity,
    queryKey: ['identity'],
    retry: false,
  });
  const signedIn = identity.data !== undefined;
  return (
    <main className="public-page">
      <header className="public-header">
        <Link className="brand" to="/">
          <span className="brand-mark">✦</span>
          <span>Club</span>
        </Link>
        <nav>
          <a className="public-info-link" href="#how">
            如何使用
          </a>
          <a className="public-info-link" href="#open-source">
            开源部署
          </a>
          {signedIn ? (
            <Link className="button small primary" to="/app">
              进入工作台
            </Link>
          ) : (
            <>
              <Link to="/login">登录</Link>
              <Link className="button small primary" to="/register">
                注册
              </Link>
            </>
          )}
        </nav>
      </header>
      <section className="public-hero">
        <div className="hero-stars" aria-hidden="true">
          <span>✦</span>
          <span>★</span>
          <span>✧</span>
          <span>★</span>
          <span>✦</span>
        </div>
        <div className="hero-copy">
          <p className="eyebrow">VTUBER GUARD GIFT PLATFORM</p>
          <h1>舰长礼物，从资格确认到收货，一处完成。</h1>
          <p>
            自动同步月末大航海名单，通过直播间验证码匹配 B站 UID，
            让每一份舰长礼物都拥有清晰、可靠的领取与发货记录。
          </p>
          <div className="hero-actions">
            <Link className="button primary large" to={signedIn ? '/app' : '/register'}>
              {signedIn ? '进入我的工作台' : '创建账号'}
            </Link>
            <a className="button ghost large" href="#how">
              了解流程
            </a>
          </div>
        </div>
        <div className="hero-preview" aria-label="礼物状态示意">
          <div className="preview-window">
            <div className="preview-bar">
              <span />
              <span />
              <span />
            </div>
            <div className="preview-banner">WELCOME TO CLUB ✦</div>
            <div className="preview-news">
              <span />
              <span />
              <span />
            </div>
            <div className="preview-gifts">
              <article>
                <i>✦</i>
                <strong>六月舰长礼物</strong>
                <small>待领取</small>
              </article>
              <article>
                <i>★</i>
                <strong>五月纪念礼包</strong>
                <small>已发货</small>
              </article>
            </div>
          </div>
        </div>
      </section>
      <section className="public-section" id="how">
        <p className="eyebrow">简单的完整闭环</p>
        <h2>不用理解后台术语，也能知道下一步做什么</h2>
        <div className="steps-grid">
          <article>
            <span>01</span>
            <h3>绑定 B站账号</h3>
            <p>在平台指定直播间发送一次性验证码，自动证明 UID。</p>
          </article>
          <article>
            <span>02</span>
            <h3>收到礼物单</h3>
            <p>月末名单与主播发布同时满足后，礼物单自动出现在仪表盘。</p>
          </article>
          <article>
            <span>03</span>
            <h3>确认领取</h3>
            <p>选择收货地址，填写礼物选项，一次提交即可锁定信息。</p>
          </article>
          <article>
            <span>04</span>
            <h3>跟踪物流</h3>
            <p>主播录入发货信息后，在同一张礼物单内查看进度。</p>
          </article>
        </div>
      </section>
      <section className="open-source-callout" id="open-source">
        <div>
          <p className="eyebrow">SELF-HOSTED & OPEN SOURCE</p>
          <h2>为主播和社群而建，也由社群掌控。</h2>
          <p>独立部署、固定清晰的产品界面、可审计的月度资格快照。</p>
        </div>
        <Link className="button light" to="/login">
          登录 Club
        </Link>
      </section>
      <footer className="public-footer">
        <span>Club</span>
        <span>开源舰长礼物领取与发货平台</span>
      </footer>
    </main>
  );
}
