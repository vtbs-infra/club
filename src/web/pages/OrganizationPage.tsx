import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';

import { downloadCurrentMonthGuardWorkbook } from '../api/fulfillment';
import { getCreators, getMembers, type Membership } from '../api/identity';
import { AuthenticatedPage } from '../components/AuthenticatedPage';

export function OrganizationPage() {
  const { organizationId = '' } = useParams();
  return (
    <AuthenticatedPage>
      {(identity) => {
        const membership = identity.memberships.find(
          (candidate) => candidate.organization.id === organizationId,
        );
        return membership ? (
          <OrganizationDetails membership={membership} organizationId={organizationId} />
        ) : (
          <Navigate replace to="/organizations" />
        );
      }}
    </AuthenticatedPage>
  );
}

interface OrganizationDetailsProperties {
  readonly membership: Membership;
  readonly organizationId: string;
}

function OrganizationDetails({ membership, organizationId }: OrganizationDetailsProperties) {
  const [exportError, setExportError] = useState('');
  const [exportingCreatorId, setExportingCreatorId] = useState('');
  const creators = useQuery({
    queryFn: () => getCreators(organizationId),
    queryKey: ['organizations', organizationId, 'creators'],
  });
  const canReadMembers = membership.role === 'OWNER' || membership.role === 'ADMIN';
  const canExportGuardAddresses = membership.role === 'OWNER' || membership.role === 'FULFILLMENT';
  const members = useQuery({
    enabled: canReadMembers,
    queryFn: () => getMembers(organizationId),
    queryKey: ['organizations', organizationId, 'members'],
  });

  return (
    <section className="page-content">
      <div className="title-row">
        <div>
          <p className="section-kicker">ORGANIZATION</p>
          <h1>{membership.organization.name}</h1>
        </div>
        <span className="role-chip">{membership.role}</span>
      </div>
      <div className="button-row">
        <Link className="button button-small" to={`/organizations/${organizationId}/campaigns`}>
          Gift campaigns
        </Link>
        <Link
          className="button button-secondary button-small"
          to={`/organizations/${organizationId}/fulfillment`}
        >
          Fulfillment
        </Link>
        <Link
          className="button button-secondary button-small"
          to={`/organizations/${organizationId}/operations`}
        >
          Operations
        </Link>
        {membership.role === 'OWNER' || membership.role === 'ADMIN' ? (
          <Link
            className="button button-secondary button-small"
            to={`/organizations/${organizationId}/announcements`}
          >
            Announcements
          </Link>
        ) : null}
      </div>
      {exportError ? (
        <p aria-live="polite" className="form-message form-error">
          {exportError}
        </p>
      ) : null}
      <div className="workspace-grid">
        <section className="panel">
          <p className="panel-label">CREATORS</p>
          <h2>{creators.data?.length ?? 0} configured</h2>
          {creators.isPending ? <p className="muted">Loading creators…</p> : null}
          <ul className="record-list">
            {creators.data?.map((creator) => (
              <li key={creator.id}>
                <div>
                  <strong>{creator.displayName}</strong>
                  <span>
                    UID {creator.bilibiliUid} · Room {creator.roomId}
                  </span>
                </div>
                <span className={creator.active ? 'status-active' : 'muted'}>
                  {creator.active ? 'Active' : 'Paused'}
                </span>
                <div className="record-actions">
                  <Link to={`/organizations/${organizationId}/creators/${creator.id}/snapshots`}>
                    Snapshots
                  </Link>
                  {canExportGuardAddresses ? (
                    <button
                      className="button button-secondary button-small"
                      disabled={Boolean(exportingCreatorId)}
                      type="button"
                      onClick={() => {
                        setExportError('');
                        setExportingCreatorId(creator.id);
                        void downloadCurrentMonthGuardWorkbook(organizationId, creator.id)
                          .catch(() => {
                            setExportError(
                              'Current-month guard address workbook could not be exported.',
                            );
                          })
                          .finally(() => setExportingCreatorId(''));
                      }}
                    >
                      {exportingCreatorId === creator.id
                        ? 'Preparing Excel…'
                        : 'Download monthly Excel'}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel">
          <p className="panel-label">TEAM ACCESS</p>
          {canReadMembers ? (
            <>
              <h2>{members.data?.length ?? 0} members</h2>
              <ul className="record-list">
                {members.data?.map((member) => (
                  <li key={member.id}>
                    <div>
                      <strong>{member.name ?? member.email ?? member.userId}</strong>
                      <span>{member.creatorIds.length ? 'Creator scoped' : 'All creators'}</span>
                    </div>
                    <span className="role-chip">{member.role}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="restricted-state">
              <h2>Restricted</h2>
              <p>Your role does not include access to member details.</p>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
