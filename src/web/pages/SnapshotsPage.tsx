import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';

import {
  approveLateSnapshot,
  checkSnapshotIntegrity,
  getCreatorSnapshots,
  getSnapshot,
  rejectLateSnapshot,
  retrySnapshot,
} from '../api/snapshots';
import { AuthenticatedPage } from '../components/AuthenticatedPage';

export function SnapshotsPage() {
  const { creatorId = '', organizationId = '' } = useParams();
  return (
    <AuthenticatedPage>
      {(identity) => {
        const membership = identity.memberships.find(
          (item) => item.organization.id === organizationId,
        );
        return membership ? (
          <SnapshotWorkspace
            creatorId={creatorId}
            canApprove={['OWNER', 'ADMIN'].includes(membership.role)}
          />
        ) : (
          <Navigate replace to="/organizations" />
        );
      }}
    </AuthenticatedPage>
  );
}

function SnapshotWorkspace({ creatorId, canApprove }: { creatorId: string; canApprove: boolean }) {
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const runs = useQuery({
    queryFn: () => getCreatorSnapshots(creatorId),
    queryKey: ['snapshots', creatorId],
  });
  const detail = useQuery({
    enabled: selectedId !== null,
    queryFn: () => getSnapshot(selectedId!),
    queryKey: ['snapshot', selectedId],
  });
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['snapshots', creatorId] });
    await client.invalidateQueries({ queryKey: ['snapshot', selectedId] });
  };
  const retry = useMutation({ mutationFn: () => retrySnapshot(selectedId!), onSuccess: refresh });
  const approve = useMutation({
    mutationFn: () => approveLateSnapshot(selectedId!),
    onSuccess: refresh,
  });
  const reject = useMutation({
    mutationFn: () => rejectLateSnapshot(selectedId!, 'Rejected after evidence review.'),
    onSuccess: refresh,
  });
  const integrity = useMutation({ mutationFn: () => checkSnapshotIntegrity(selectedId!) });

  return (
    <section className="page-content">
      <p className="section-kicker">MONTH-END EVIDENCE</p>
      <h1>Guard roster snapshots</h1>
      <div className="workspace-grid">
        <section className="panel">
          <h2>Runs</h2>
          <ul className="record-list">
            {runs.data?.map((run) => (
              <li key={run.id}>
                <button className="text-button" onClick={() => setSelectedId(run.id)} type="button">
                  <strong>{run.periodStart.slice(0, 7)}</strong>
                  <span>
                    {run.status} · {new Date(run.scheduledCutoffAt).toLocaleString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel">
          <h2>Attempt evidence</h2>
          {!detail.data ? (
            <p className="muted">Select a run to inspect attempts and raw-page metadata.</p>
          ) : null}
          {detail.data ? (
            <>
              <p>
                <span className="status-active">{detail.data.run.status}</span> ·{' '}
                {detail.data.run.cutoffTimezone}
              </p>
              <div className="button-row">
                {['FAILED', 'REJECTED'].includes(detail.data.run.status) ? (
                  <button disabled={retry.isPending} onClick={() => retry.mutate()} type="button">
                    Retry capture
                  </button>
                ) : null}
                {detail.data.run.status === 'PENDING_APPROVAL' && canApprove ? (
                  <>
                    <button
                      disabled={approve.isPending}
                      onClick={() => approve.mutate()}
                      type="button"
                    >
                      Approve late
                    </button>
                    <button
                      className="secondary-button"
                      disabled={reject.isPending}
                      onClick={() => reject.mutate()}
                      type="button"
                    >
                      Reject
                    </button>
                  </>
                ) : null}
                <button
                  className="secondary-button"
                  onClick={() => integrity.mutate()}
                  type="button"
                >
                  Check evidence
                </button>
              </div>
              {integrity.data ? (
                <p>
                  {integrity.data.every((page) => page.ok)
                    ? 'All raw objects match their SHA-256 hashes.'
                    : 'Raw evidence is missing or damaged.'}
                </p>
              ) : null}
              <ul className="record-list">
                {detail.data.attempts.map((attempt) => (
                  <li key={attempt.id}>
                    <div>
                      <strong>
                        Attempt {attempt.attemptNumber} · {attempt.consistencyStatus}
                      </strong>
                      <span>
                        {attempt.punctuality ?? 'Not started'} · {attempt.normalizedTotal ?? 0}/
                        {attempt.declaredTotal ?? '?'} members
                      </span>
                      {attempt.failureCode ? (
                        <span>
                          {attempt.failureCode}: {attempt.failureMessage}
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
              <p className="muted">
                {detail.data.pages.length} raw gzip page objects recorded. Full payloads are never
                stored in PostgreSQL.
              </p>
            </>
          ) : null}
        </section>
      </div>
    </section>
  );
}
