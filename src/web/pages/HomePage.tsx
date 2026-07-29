import { useQuery } from '@tanstack/react-query';

import { defaultSitePageContent, type SiteHomeResponse } from '../../shared/site-content';
import { getHomepage } from '../api/site-content';
import { HomeRenderer } from '../components/home/HomeRenderer';
import { LoadingState } from '../components/Ui';

const fallbackHome: SiteHomeResponse = {
  announcements: [],
  campaigns: [],
  content: defaultSitePageContent,
  user: null,
};

export function HomePage() {
  const home = useQuery({
    queryFn: getHomepage,
    queryKey: ['site', 'home'],
    retry: false,
  });
  if (home.isPending) {
    return (
      <main className="centered-state">
        <LoadingState label="正在打开舰长礼物站…" />
      </main>
    );
  }
  return (
    <>
      {home.isError ? (
        <div className="portal-fallback-notice" role="status">
          个性化内容暂时无法加载，当前显示默认首页。
        </div>
      ) : null}
      <HomeRenderer home={home.data ?? fallbackHome} />
    </>
  );
}
