import { useQuery } from '@tanstack/react-query';

import { getMyEntitlements } from '../api/campaigns';

export function GiftCardsPanel() {
  const gifts = useQuery({ queryFn: getMyEntitlements, queryKey: ['me', 'entitlements'] });
  return (
    <section className="panel account-section">
      <p className="panel-label">MY GIFTS</p>
      <h2>Gift cards</h2>
      {gifts.isPending ? <p className="muted">Loading gifts…</p> : null}
      {gifts.isError ? <p className="form-message form-error">Could not load your gifts.</p> : null}
      {gifts.data?.length === 0 ? (
        <p className="muted">No gifts match your active Bilibili UID yet.</p>
      ) : null}
      <div className="gift-card-grid">
        {gifts.data?.map(({ campaign, entitlements }) => (
          <article className="gift-card" key={campaign.id}>
            <div className="title-row compact-title">
              <div>
                <span className="role-chip">{campaign.status}</span>
                <h3>{campaign.title}</h3>
              </div>
              <span className="muted">{campaign.periodStart.slice(0, 7)}</span>
            </div>
            <p>{campaign.description || 'Monthly guard gift'}</p>
            <ul>
              {entitlements.map((entitlement) => (
                <li key={entitlement.id}>
                  <strong>{entitlement.giftPackage.name}</strong>
                  <span className={entitlement.revokedAt ? 'status-revoked' : 'status-active'}>
                    {entitlement.revokedAt ? 'Revoked' : entitlement.tier}
                  </span>
                </li>
              ))}
            </ul>
            <small>Claim by {new Date(campaign.claimDeadlineAt).toLocaleString()}</small>
          </article>
        ))}
      </div>
    </section>
  );
}
