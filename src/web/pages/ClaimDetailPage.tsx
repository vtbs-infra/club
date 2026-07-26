import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';

import { getAddresses } from '../api/addresses';
import { getMyCampaign } from '../api/campaigns';
import {
  cancelClaim,
  confirmClaimReceipt,
  getClaim,
  updateClaimAddress,
  updateClaimOptions,
  type ClaimDetail,
} from '../api/claims';
import { AuthenticatedPage } from '../components/AuthenticatedPage';

export function ClaimDetailPage() {
  const { claimId = '' } = useParams();
  return <AuthenticatedPage>{() => <ClaimDetailLoader claimId={claimId} />}</AuthenticatedPage>;
}

function ClaimDetailLoader({ claimId }: { readonly claimId: string }) {
  const detail = useQuery({
    queryFn: () => getClaim(claimId),
    queryKey: ['me', 'claims', claimId],
  });
  if (detail.isPending) return <p className="page-state">Loading claim…</p>;
  if (!detail.data) return <p className="page-state page-error">Claim could not be loaded.</p>;
  return <ClaimDetailCard claim={detail.data} key={`${detail.data.id}:${detail.data.version}`} />;
}

function ClaimDetailCard({ claim }: { readonly claim: ClaimDetail }) {
  const queryClient = useQueryClient();
  const campaign = useQuery({
    queryFn: () => getMyCampaign(claim.campaignId),
    queryKey: ['me', 'campaigns', claim.campaignId],
  });
  const addresses = useQuery({ queryFn: getAddresses, queryKey: ['me', 'addresses'] });
  const [addressId, setAddressId] = useState('');
  const [options, setOptions] = useState<Record<string, string>>({ ...claim.optionValues });
  const [cancelReason, setCancelReason] = useState('No longer needed');
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['me', 'claims', claim.id] }),
      queryClient.invalidateQueries({ queryKey: ['me', 'claims'] }),
      queryClient.invalidateQueries({ queryKey: ['me', 'entitlements'] }),
      queryClient.invalidateQueries({ queryKey: ['me', 'campaigns', claim.campaignId] }),
    ]);
  };
  const addressMutation = useMutation({
    mutationFn: () => updateClaimAddress(claim.id, addressId, claim.version),
    onSuccess: refresh,
  });
  const optionMutation = useMutation({
    mutationFn: () => updateClaimOptions(claim.id, options, claim.version),
    onSuccess: refresh,
  });
  const cancel = useMutation({
    mutationFn: () => cancelClaim(claim.id, claim.version, cancelReason),
    onSuccess: refresh,
  });
  const confirm = useMutation({
    mutationFn: () => confirmClaimReceipt(claim.id, claim.version),
    onSuccess: refresh,
  });

  return (
    <section className="page-content">
      <p className="section-kicker">CLAIM DETAIL</p>
      <div className="title-row">
        <div>
          <h1>{claim.claimNumber}</h1>
          <p className="lede">A stable reference for this gift claim.</p>
        </div>
        <span className="role-chip">{claim.status}</span>
      </div>
      <div className="gift-detail-grid">
        <section className="panel campaign-editor">
          <p className="panel-label">PACKAGES</p>
          <ul className="record-list">
            {claim.packages.map((item) => (
              <li key={item.entitlementId}>
                <strong>{item.giftPackage.name}</strong>
              </li>
            ))}
          </ul>
          <p className="panel-label">DELIVERY SNAPSHOT</p>
          {claim.address ? (
            <address>
              {claim.address.recipientName}
              <br />
              {claim.address.phone}
              <br />
              {claim.address.countryRegion} {claim.address.province} {claim.address.city}{' '}
              {claim.address.district}
              <br />
              {claim.address.detailedAddress} {claim.address.postalCode}
            </address>
          ) : null}
        </section>
        <section className="panel campaign-editor campaign-form">
          <p className="panel-label">STATUS HISTORY</p>
          <ol className="timeline">
            {claim.history.map((item) => (
              <li key={`${item.createdAt}:${item.toStatus}`}>
                <strong>{item.toStatus}</strong>
                <span>{new Date(item.createdAt).toLocaleString()}</span>
                {item.reason ? <small>{item.reason}</small> : null}
              </li>
            ))}
          </ol>
          {claim.status === 'SUBMITTED' ? (
            <>
              <label>
                Change address
                <select value={addressId} onChange={(event) => setAddressId(event.target.value)}>
                  <option value="">Select an address</option>
                  {addresses.data?.map((address) => (
                    <option key={address.id} value={address.id}>
                      {address.label} · {address.payload.recipientName}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="button button-secondary"
                disabled={!addressId || addressMutation.isPending}
                onClick={() => addressMutation.mutate()}
                type="button"
              >
                Update claim address
              </button>
              {campaign.data?.campaign.claimFormSchema.map((field) => (
                <label key={field.key}>
                  {field.label}
                  {field.type === 'SELECT' ? (
                    <select
                      value={options[field.key] ?? ''}
                      onChange={(event) =>
                        setOptions((current) => ({ ...current, [field.key]: event.target.value }))
                      }
                    >
                      {field.options?.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={options[field.key] ?? ''}
                      onChange={(event) =>
                        setOptions((current) => ({ ...current, [field.key]: event.target.value }))
                      }
                    />
                  )}
                </label>
              ))}
              {campaign.data?.campaign.claimFormSchema.length ? (
                <button
                  className="button button-secondary"
                  disabled={optionMutation.isPending}
                  onClick={() => optionMutation.mutate()}
                  type="button"
                >
                  Update claim options
                </button>
              ) : null}
              <label>
                Cancellation reason
                <input
                  value={cancelReason}
                  onChange={(event) => setCancelReason(event.target.value)}
                />
              </label>
              <button
                className="button button-quiet"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate()}
                type="button"
              >
                Cancel claim
              </button>
            </>
          ) : null}
          {claim.status === 'SHIPPED' ? (
            <button
              className="button"
              disabled={confirm.isPending}
              onClick={() => confirm.mutate()}
              type="button"
            >
              Confirm receipt
            </button>
          ) : null}
          {addressMutation.isError ||
          optionMutation.isError ||
          cancel.isError ||
          confirm.isError ? (
            <p className="form-message form-error">
              {addressMutation.error?.message ??
                optionMutation.error?.message ??
                cancel.error?.message ??
                confirm.error?.message}
            </p>
          ) : null}
        </section>
      </div>
    </section>
  );
}
