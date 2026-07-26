import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { getClaims } from '../api/claims';
import { AuthenticatedPage } from '../components/AuthenticatedPage';

export function ClaimsPage() {
  return <AuthenticatedPage>{() => <ClaimHistory />}</AuthenticatedPage>;
}

function ClaimHistory() {
  const claims = useQuery({ queryFn: getClaims, queryKey: ['me', 'claims'] });
  return (
    <section className="page-content">
      <p className="section-kicker">CLAIM HISTORY</p>
      <h1>Your claims</h1>
      <div className="card-grid">
        {claims.data?.map((claim) => (
          <Link className="panel organization-card" key={claim.id} to={`/claims/${claim.id}`}>
            <span className="role-chip">{claim.status}</span>
            <h2>{claim.claimNumber}</h2>
            <p>Submitted {new Date(claim.submittedAt).toLocaleString()}</p>
            <span className="card-link">View claim →</span>
          </Link>
        ))}
      </div>
      {claims.data?.length === 0 ? (
        <section className="panel empty-state">
          <h2>No claims yet</h2>
          <p>Your claimed gifts will appear here.</p>
        </section>
      ) : null}
    </section>
  );
}
