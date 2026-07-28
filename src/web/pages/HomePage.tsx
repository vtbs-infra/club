import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { defaultSitePageContent, type SiteHomeResponse } from '../../shared/site-content';
import { getIdentity } from '../api/identity';
import { ApiError } from '../api/http';
import { getHome } from '../api/site-content';
import { HomeRenderer } from '../components/home/HomeRenderer';
import { SiteHeader } from '../components/SiteHeader';

const fallbackHome: SiteHomeResponse = {
  announcements: [],
  campaigns: [],
  content: defaultSitePageContent,
  user: null,
};

export function HomePage() {
  const identity = useQuery({
    queryFn: getIdentity,
    queryKey: ['identity'],
    retry: false,
  });
  const home = useQuery({ queryFn: getHome, queryKey: ['site', 'home'], retry: false });
  const signedIn = identity.data ?? null;
  const unavailable =
    home.isError && !(home.error instanceof ApiError && home.error.status === 401);

  return (
    <main className="shell home-shell">
      <SiteHeader
        authenticated={Boolean(signedIn)}
        platformAdmin={signedIn?.user.platformRole === 'PLATFORM_ADMIN'}
      />
      {unavailable ? (
        <div className="home-service-note" role="status">
          个性化内容暂时无法加载，当前显示默认首页。
        </div>
      ) : null}
      <HomeRenderer home={home.data ?? fallbackHome} identity={signedIn} />
      <footer className="home-footer">
        <div>
          <strong>{(home.data ?? fallbackHome).content.site.name}</strong>
          <span>{(home.data ?? fallbackHome).content.site.footerText}</span>
        </div>
        <nav aria-label="页脚导航">
          <Link to="/announcements">公告</Link>
          <a href="https://github.com/vtbs-infra/club">开源项目</a>
          <Link to="/account">联系管理员</Link>
        </nav>
      </footer>
      <nav className="home-mobile-navigation" aria-label="移动端导航">
        <Link to="/">首页</Link>
        <Link to="/claims">礼物</Link>
        <Link to="/announcements">公告</Link>
        <Link to={signedIn ? '/account' : '/login'}>{signedIn ? '我的' : '登录'}</Link>
      </nav>
    </main>
  );
}
