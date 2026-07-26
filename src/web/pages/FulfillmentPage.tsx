import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { Navigate, useParams } from 'react-router-dom';

import {
  createShipment,
  downloadFulfillmentCsv,
  downloadShipmentTemplate,
  getFulfillmentClaim,
  getFulfillmentClaims,
  importShipments,
  processClaims,
  refreshShipment,
  type FulfillmentClaim,
} from '../api/fulfillment';
import type { Membership } from '../api/identity';
import { AuthenticatedPage } from '../components/AuthenticatedPage';

export function FulfillmentPage() {
  const { organizationId = '' } = useParams();
  return (
    <AuthenticatedPage>
      {(identity) => {
        const membership = identity.memberships.find(
          (candidate) => candidate.organization.id === organizationId,
        );
        return membership ? (
          <FulfillmentWorkspace membership={membership} organizationId={organizationId} />
        ) : (
          <Navigate replace to="/organizations" />
        );
      }}
    </AuthenticatedPage>
  );
}

function FulfillmentWorkspace({
  membership,
  organizationId,
}: {
  readonly membership: Membership;
  readonly organizationId: string;
}) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [activeClaimId, setActiveClaimId] = useState('');
  const [csv, setCsv] = useState('');
  const canManage = membership.role === 'OWNER' || membership.role === 'FULFILLMENT';
  const claims = useQuery({
    queryFn: () => getFulfillmentClaims(organizationId, { status }),
    queryKey: ['organizations', organizationId, 'fulfillment', status],
  });
  const process = useMutation({
    mutationFn: () => processClaims(organizationId, selected, crypto.randomUUID()),
    onSuccess: async () => {
      setSelected([]);
      await queryClient.invalidateQueries({
        queryKey: ['organizations', organizationId, 'fulfillment'],
      });
    },
  });
  const imported = useMutation({
    mutationFn: () => importShipments(organizationId, csv),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['organizations', organizationId, 'fulfillment'],
      });
    },
  });
  const exceptions = claims.data?.flatMap((claim) =>
    claim.shipments
      .filter((shipment) => shipment.status === 'EXCEPTION')
      .map((shipment) => ({ claim, shipment })),
  );

  return (
    <section className="page-content">
      <div className="title-row">
        <div>
          <p className="section-kicker">FULFILLMENT</p>
          <h1>Claims and shipments</h1>
          <p className="lede">
            Process claims, export delivery data, and import tracking by claim number.
          </p>
        </div>
        <span className="role-chip">{membership.role}</span>
      </div>
      <section className="panel fulfillment-toolbar">
        <label>
          Claim status
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All statuses</option>
            {['SUBMITTED', 'PROCESSING', 'SHIPPED', 'COMPLETED', 'CANCELLED'].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        {canManage ? (
          <div className="button-row">
            <button
              className="button button-small"
              disabled={!selected.length || process.isPending}
              onClick={() => process.mutate()}
              type="button"
            >
              Process selected
            </button>
            <button
              className="button button-secondary button-small"
              onClick={() => void downloadFulfillmentCsv(organizationId)}
              type="button"
            >
              Export addresses
            </button>
            <button
              className="button button-secondary button-small"
              onClick={() => void downloadShipmentTemplate()}
              type="button"
            >
              Import template
            </button>
          </div>
        ) : null}
      </section>
      <div className="fulfillment-layout">
        <section className="panel">
          <p className="panel-label">CLAIM QUEUE</p>
          {claims.isPending ? <p className="muted">Loading claims…</p> : null}
          {!claims.data?.length ? <p className="muted">No claims match this filter.</p> : null}
          <ul className="record-list fulfillment-list">
            {claims.data?.map((claim) => (
              <ClaimRow
                canManage={canManage}
                claim={claim}
                key={claim.id}
                onOpen={() => setActiveClaimId(claim.id)}
                onSelect={(checked) =>
                  setSelected((current) =>
                    checked
                      ? [...new Set([...current, claim.id])]
                      : current.filter((id) => id !== claim.id),
                  )
                }
                selected={selected.includes(claim.id)}
              />
            ))}
          </ul>
        </section>
        <div>
          {activeClaimId ? (
            <FulfillmentDetail claimId={activeClaimId} canManage={canManage} />
          ) : (
            <section className="panel restricted-state">
              <h2>Select a claim</h2>
              <p>Review its frozen delivery address and shipment history.</p>
            </section>
          )}
        </div>
      </div>
      {canManage ? (
        <section className="panel campaign-form">
          <p className="panel-label">TRACKING CSV IMPORT</p>
          <input
            accept=".csv,text/csv"
            aria-label="Shipment CSV file"
            type="file"
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              const file = event.target.files?.[0];
              if (file) void file.text().then(setCsv);
            }}
          />
          <textarea
            aria-label="Shipment CSV"
            rows={6}
            value={csv}
            onChange={(event) => setCsv(event.target.value)}
          />
          <button
            className="button button-small"
            disabled={!csv || imported.isPending}
            onClick={() => imported.mutate()}
            type="button"
          >
            Import shipments
          </button>
          {imported.data ? (
            <p className="form-message">
              {imported.data.results.filter((row) => row.status === 'IMPORTED').length} imported,{' '}
              {imported.data.results.filter((row) => row.status === 'UNCHANGED').length} unchanged,{' '}
              {imported.data.results.filter((row) => row.status === 'ERROR').length} errors.
            </p>
          ) : null}
          {imported.data?.results.some((row) => row.status === 'ERROR') ? (
            <ul className="record-list">
              {imported.data.results
                .filter((row) => row.status === 'ERROR')
                .map((row) => (
                  <li key={row.rowNumber}>
                    <strong>Row {row.rowNumber}</strong>
                    <span>{row.message}</span>
                  </li>
                ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      <section className="panel">
        <p className="panel-label">EXCEPTIONS</p>
        {!exceptions?.length ? <p className="muted">No tracking exceptions.</p> : null}
        <ul className="record-list">
          {exceptions?.map(({ claim, shipment }) => (
            <li key={shipment.id}>
              <strong>{claim.claimNumber}</strong>
              <span>{shipment.exceptionMessage ?? 'Tracking requires attention.'}</span>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}

function ClaimRow({
  canManage,
  claim,
  onOpen,
  onSelect,
  selected,
}: {
  readonly canManage: boolean;
  readonly claim: FulfillmentClaim;
  readonly onOpen: () => void;
  readonly onSelect: (checked: boolean) => void;
  readonly selected: boolean;
}) {
  return (
    <li>
      {canManage && claim.status === 'SUBMITTED' ? (
        <input
          aria-label={`Select ${claim.claimNumber}`}
          checked={selected}
          type="checkbox"
          onChange={(event) => onSelect(event.target.checked)}
        />
      ) : null}
      <button className="record-button" onClick={onOpen} type="button">
        <strong>{claim.claimNumber}</strong>
        <span>{claim.campaignTitle}</span>
        <small>
          {claim.status} · {claim.shipments.length} shipments
        </small>
      </button>
    </li>
  );
}

function FulfillmentDetail({
  canManage,
  claimId,
}: {
  readonly canManage: boolean;
  readonly claimId: string;
}) {
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryFn: () => getFulfillmentClaim(claimId),
    queryKey: ['fulfillment', 'claims', claimId],
  });
  const [shipmentKey, setShipmentKey] = useState('box-1');
  const [carrierCode, setCarrierCode] = useState('manual');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [trackingUrl, setTrackingUrl] = useState('');
  const [itemIds, setItemIds] = useState('');
  const create = useMutation({
    mutationFn: () =>
      createShipment(claimId, {
        carrierCode,
        ...(itemIds.trim()
          ? {
              claimEntitlementIds: itemIds
                .split(';')
                .map((value) => value.trim())
                .filter(Boolean),
            }
          : {}),
        shipmentKey,
        trackingNumber,
        trackingUrl,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['fulfillment', 'claims', claimId] }),
        queryClient.invalidateQueries({ queryKey: ['organizations'] }),
      ]);
    },
  });
  const refresh = useMutation({
    mutationFn: refreshShipment,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['fulfillment', 'claims', claimId] });
    },
  });
  const unassignedHint = useMemo(
    () =>
      detail.data?.shipments.flatMap((shipment) => shipment.claimEntitlementIds).length
        ? 'Leave blank to assign every remaining package.'
        : 'Leave blank to ship every package in one shipment.',
    [detail.data],
  );
  if (detail.isPending) return <section className="panel">Loading fulfillment detail…</section>;
  if (!detail.data) return <section className="panel">Fulfillment detail unavailable.</section>;
  return (
    <section className="panel campaign-form">
      <p className="panel-label">DELIVERY DETAIL</p>
      <h2>{detail.data.claim.claimNumber}</h2>
      <address>
        {detail.data.address.recipientName} · {detail.data.address.phone}
        <br />
        {detail.data.address.countryRegion} {detail.data.address.province}{' '}
        {detail.data.address.city} {detail.data.address.district}
        <br />
        {detail.data.address.detailedAddress} {detail.data.address.postalCode}
      </address>
      <ul className="record-list">
        {detail.data.shipments.map((shipment) => (
          <li key={shipment.id}>
            <div>
              <strong>{shipment.shipmentNumber}</strong>
              <span>
                {shipment.carrierCode} · {shipment.trackingNumber}
              </span>
              <small>{shipment.status}</small>
            </div>
            {canManage ? (
              <button
                className="button button-quiet button-small"
                disabled={refresh.isPending}
                onClick={() => refresh.mutate(shipment.id)}
                type="button"
              >
                Refresh
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {canManage && detail.data.claim.status === 'PROCESSING' ? (
        <form
          className="campaign-form"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <label>
            Shipment key
            <input
              required
              value={shipmentKey}
              onChange={(event) => setShipmentKey(event.target.value)}
            />
          </label>
          <label>
            Carrier code
            <input
              required
              value={carrierCode}
              onChange={(event) => setCarrierCode(event.target.value)}
            />
          </label>
          <label>
            Tracking number
            <input
              required
              value={trackingNumber}
              onChange={(event) => setTrackingNumber(event.target.value)}
            />
          </label>
          <label>
            Public tracking URL
            <input value={trackingUrl} onChange={(event) => setTrackingUrl(event.target.value)} />
          </label>
          <label>
            Claim entitlement IDs (semicolon separated)
            <input value={itemIds} onChange={(event) => setItemIds(event.target.value)} />
            <small>{unassignedHint}</small>
          </label>
          <button className="button button-small" disabled={create.isPending} type="submit">
            Create shipment
          </button>
          {create.isError ? (
            <p className="form-message form-error">{create.error.message}</p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
