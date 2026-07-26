import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useParams } from 'react-router-dom';

import {
  getOrganizationAuditLogs,
  getOrganizationSystemStatus,
  getPlatformAuditLogs,
  getPlatformSystemStatus,
  type AuditLog,
  type OrganizationSystemStatus,
  type PlatformSystemStatus,
} from '../api/operations';
import { AuthenticatedPage } from '../components/AuthenticatedPage';

function Stat({ label, value }: { readonly label: string; readonly value: number | string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AuditTimeline({ logs }: { readonly logs: readonly AuditLog[] }) {
  return (
    <section className="panel operations-panel">
      <p className="panel-label">AUDIT TRAIL</p>
      <h2>Recent changes</h2>
      <ol className="timeline audit-timeline">
        {logs.map((item) => (
          <li key={item.id}>
            <strong>{item.action}</strong>
            <span>
              {new Date(item.createdAt).toLocaleString()} · {item.targetType}
            </span>
            <small>
              {item.targetId} · {JSON.stringify(item.afterSummary ?? item.beforeSummary ?? {})}
            </small>
          </li>
        ))}
      </ol>
      {logs.length === 0 ? <p className="muted">No audit events are visible.</p> : null}
    </section>
  );
}

function DependencyCards({
  status,
}: {
  readonly status: OrganizationSystemStatus | PlatformSystemStatus;
}) {
  return (
    <div className="status-summary">
      <Stat label="Overall" value={status.status.toUpperCase()} />
      <Stat label="Database" value={status.checks.database.toUpperCase()} />
      <Stat label="Storage" value={status.checks.storage.toUpperCase()} />
      <Stat
        label="Snapshot scheduler"
        value={status.schedulers.snapshot.running ? 'RUNNING' : 'STOPPED'}
      />
      <Stat
        label="Tracking scheduler"
        value={
          status.schedulers.tracking.configured
            ? status.schedulers.tracking.running
              ? 'RUNNING'
              : 'STOPPED'
            : 'NOT CONFIGURED'
        }
      />
      <Stat label="Tracking due" value={status.tracking.dueCount} />
    </div>
  );
}

function FailurePanel({
  failures,
}: {
  readonly failures: OrganizationSystemStatus['recentSnapshotFailures'];
}) {
  return (
    <section className="panel operations-panel">
      <p className="panel-label">CAPTURE DIAGNOSTICS</p>
      <h2>Recent snapshot failures</h2>
      <ul className="record-list">
        {failures.map((failure) => (
          <li key={`${failure.runId}:${failure.createdAt}`}>
            <div>
              <strong>{failure.failureCode}</strong>
              <span>Creator {failure.creatorId}</span>
              <small>{new Date(failure.createdAt).toLocaleString()}</small>
            </div>
            <span className="role-chip">{failure.runId.slice(0, 8)}</span>
          </li>
        ))}
      </ul>
      {failures.length === 0 ? <p className="muted">No recent failed captures.</p> : null}
    </section>
  );
}

export function OrganizationOperationsPage() {
  const { organizationId = '' } = useParams();
  return (
    <AuthenticatedPage>
      {(identity) => {
        const membership = identity.memberships.find(
          (candidate) => candidate.organization.id === organizationId,
        );
        return membership ? (
          <OrganizationOperations
            canAudit={membership.role === 'OWNER' || membership.role === 'ADMIN'}
            organizationId={organizationId}
          />
        ) : (
          <Navigate replace to="/organizations" />
        );
      }}
    </AuthenticatedPage>
  );
}

function OrganizationOperations({
  canAudit,
  organizationId,
}: {
  readonly canAudit: boolean;
  readonly organizationId: string;
}) {
  const status = useQuery({
    queryFn: () => getOrganizationSystemStatus(organizationId),
    queryKey: ['organizations', organizationId, 'system-status'],
    refetchInterval: 10_000,
  });
  const audit = useQuery({
    enabled: canAudit,
    queryFn: () => getOrganizationAuditLogs(organizationId),
    queryKey: ['organizations', organizationId, 'audit-logs'],
    refetchInterval: 15_000,
  });
  return (
    <section className="page-content">
      <p className="section-kicker">OPERATIONS</p>
      <h1>System status.</h1>
      <p className="lede">
        A sanitized view of capture, storage, room, and tracking health for this organization.
      </p>
      {status.data ? <DependencyCards status={status.data} /> : null}
      {status.data ? (
        <div className="operations-grid">
          <FailurePanel failures={status.data.recentSnapshotFailures} />
          <section className="panel operations-panel">
            <p className="panel-label">INTEGRITY & DELIVERY</p>
            <h2>Actionable counts</h2>
            <div className="detail-list compact-details">
              <div>
                <span>Missing snapshot objects</span>
                <strong>{status.data.integrityWarningCount}</strong>
              </div>
              <div>
                <span>Tracking exceptions</span>
                <strong>{status.data.tracking.exceptionCount}</strong>
              </div>
              <div>
                <span>Room health</span>
                <strong>{JSON.stringify(status.data.roomHealthCounts)}</strong>
              </div>
              <div>
                <span>Snapshot runs</span>
                <strong>{JSON.stringify(status.data.snapshotRunCounts)}</strong>
              </div>
            </div>
          </section>
        </div>
      ) : null}
      {status.isError ? (
        <p className="form-message form-error">System status could not be loaded.</p>
      ) : null}
      {canAudit ? (
        <AuditTimeline logs={audit.data?.items ?? []} />
      ) : (
        <section className="panel operations-panel restricted-state">
          <h2>Audit details restricted</h2>
          <p>Your role can see health summaries, but not the organization audit trail.</p>
        </section>
      )}
    </section>
  );
}

export function PlatformOperationsPage() {
  return (
    <AuthenticatedPage>
      {(identity) =>
        identity.user.platformRole === 'PLATFORM_ADMIN' ? (
          <PlatformOperations />
        ) : (
          <Navigate replace to="/organizations" />
        )
      }
    </AuthenticatedPage>
  );
}

function PlatformOperations() {
  const status = useQuery({
    queryFn: getPlatformSystemStatus,
    queryKey: ['platform', 'system-status'],
    refetchInterval: 10_000,
  });
  const audit = useQuery({
    queryFn: getPlatformAuditLogs,
    queryKey: ['platform', 'audit-logs'],
    refetchInterval: 15_000,
  });
  return (
    <section className="page-content">
      <p className="section-kicker">PLATFORM OPERATIONS</p>
      <div className="title-row">
        <div>
          <h1>System status.</h1>
          <p className="lede">Diagnose schedulers, room connectivity, captures, and storage.</p>
        </div>
        <div className="button-row">
          <Link className="button button-secondary button-small" to="/platform/verification-rooms">
            Verification rooms
          </Link>
          <Link className="button button-small" to="/platform/announcements">
            Announcements
          </Link>
        </div>
      </div>
      {status.data ? <DependencyCards status={status.data} /> : null}
      {status.data ? (
        <div className="operations-grid">
          <FailurePanel failures={status.data.recentSnapshotFailures} />
          <section className="panel operations-panel">
            <p className="panel-label">ROOM CONNECTIONS</p>
            <h2>Verification rooms</h2>
            <ul className="record-list">
              {status.data.rooms.map((room) => (
                <li key={room.displayName}>
                  <div>
                    <strong>{room.displayName}</strong>
                    <span>
                      Last connected{' '}
                      {room.lastConnectedAt
                        ? new Date(room.lastConnectedAt).toLocaleString()
                        : 'never'}
                    </span>
                  </div>
                  <span
                    className={`connection-state connection-${room.healthStatus.toLowerCase()}`}
                  >
                    {room.enabled ? room.healthStatus : 'DISABLED'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section className="panel operations-panel">
            <p className="panel-label">STORAGE INTEGRITY</p>
            <h2>{status.data.integrityWarnings.length} warnings</h2>
            <ul className="record-list">
              {status.data.integrityWarnings.map((warning) => (
                <li key={warning.pageId}>
                  <div>
                    <strong>Snapshot object missing</strong>
                    <span>Creator {warning.creatorId}</span>
                  </div>
                  <span className="role-chip">{warning.runId.slice(0, 8)}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="panel operations-panel">
            <p className="panel-label">WORKLOAD</p>
            <h2>Current counts</h2>
            <div className="detail-list compact-details">
              <div>
                <span>Snapshot runs</span>
                <strong>{JSON.stringify(status.data.snapshotRunCounts)}</strong>
              </div>
              <div>
                <span>Shipments</span>
                <strong>{JSON.stringify(status.data.tracking.shipmentCounts)}</strong>
              </div>
            </div>
          </section>
        </div>
      ) : null}
      <AuditTimeline logs={audit.data?.items ?? []} />
    </section>
  );
}
