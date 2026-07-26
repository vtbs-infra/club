import { Navigate } from 'react-router-dom';

import { AnnouncementEditor } from '../components/AnnouncementEditor';
import { AuthenticatedPage } from '../components/AuthenticatedPage';

export function PlatformAnnouncementsPage() {
  return (
    <AuthenticatedPage>
      {(identity) =>
        identity.user.platformRole === 'PLATFORM_ADMIN' ? (
          <section className="page-content">
            <p className="section-kicker">PLATFORM COMMUNICATIONS</p>
            <h1>Platform notices.</h1>
            <p className="lede">
              Publish pinned service-wide notices without exposing operational secrets.
            </p>
            <AnnouncementEditor />
          </section>
        ) : (
          <Navigate replace to="/organizations" />
        )
      }
    </AuthenticatedPage>
  );
}
