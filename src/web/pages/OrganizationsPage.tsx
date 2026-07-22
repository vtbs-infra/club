import { Link } from 'react-router-dom';

import { AuthenticatedPage } from '../components/AuthenticatedPage';

export function OrganizationsPage() {
  return (
    <AuthenticatedPage>
      {(identity) => (
        <section className="page-content">
          <p className="section-kicker">WORKSPACES</p>
          <h1>Your organizations.</h1>
          <p className="lede">Choose a workspace to manage its creators and team access.</p>
          {identity.memberships.length === 0 ? (
            <div className="panel empty-state">
              <h2>No organization yet</h2>
              <p>An organization owner or platform administrator can add your account.</p>
            </div>
          ) : (
            <div className="card-grid">
              {identity.memberships.map((membership) => (
                <Link
                  className="panel organization-card"
                  key={membership.id}
                  to={`/organizations/${membership.organization.id}`}
                >
                  <span className="role-chip">{membership.role}</span>
                  <h2>{membership.organization.name}</h2>
                  <p>{membership.organization.slug}</p>
                  <span className="card-link">Open organization →</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}
    </AuthenticatedPage>
  );
}
