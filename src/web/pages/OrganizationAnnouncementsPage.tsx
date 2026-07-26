import { Navigate, useParams } from 'react-router-dom';

import { AnnouncementEditor } from '../components/AnnouncementEditor';
import { AuthenticatedPage } from '../components/AuthenticatedPage';

export function OrganizationAnnouncementsPage() {
  const { organizationId = '' } = useParams();
  return (
    <AuthenticatedPage>
      {(identity) => {
        const membership = identity.memberships.find(
          (candidate) => candidate.organization.id === organizationId,
        );
        if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
          return <Navigate replace to={`/organizations/${organizationId}`} />;
        }
        return (
          <section className="page-content">
            <p className="section-kicker">ORGANIZATION COMMUNICATIONS</p>
            <h1>Announcements.</h1>
            <p className="lede">
              Publish organization, creator, or campaign notices with clear visibility windows.
            </p>
            <AnnouncementEditor organizationId={organizationId} />
          </section>
        );
      }}
    </AuthenticatedPage>
  );
}
