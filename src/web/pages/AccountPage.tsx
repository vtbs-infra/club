import { AuthenticatedPage } from '../components/AuthenticatedPage';

export function AccountPage() {
  return (
    <AuthenticatedPage>
      {(identity) => (
        <section className="page-content">
          <p className="section-kicker">ACCOUNT</p>
          <h1>{identity.user.name}</h1>
          <div className="panel detail-list">
            <div>
              <span>Email</span>
              <strong>{identity.user.email}</strong>
            </div>
            <div>
              <span>Platform role</span>
              <strong>{identity.user.platformRole.replace('_', ' ')}</strong>
            </div>
            <div>
              <span>Organizations</span>
              <strong>{identity.memberships.length}</strong>
            </div>
          </div>
        </section>
      )}
    </AuthenticatedPage>
  );
}
