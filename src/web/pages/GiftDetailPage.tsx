import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';

import { getAddresses } from '../api/addresses';
import { getMyCampaign } from '../api/campaigns';
import { submitClaim } from '../api/claims';
import { AuthenticatedPage } from '../components/AuthenticatedPage';

export function GiftDetailPage() {
  const { campaignId = '' } = useParams();
  return <AuthenticatedPage>{() => <GiftDetail campaignId={campaignId} />}</AuthenticatedPage>;
}

function GiftDetail({ campaignId }: { readonly campaignId: string }) {
  const queryClient = useQueryClient();
  const gift = useQuery({
    queryFn: () => getMyCampaign(campaignId),
    queryKey: ['me', 'campaigns', campaignId],
  });
  const addresses = useQuery({ queryFn: getAddresses, queryKey: ['me', 'addresses'] });
  const [addressId, setAddressId] = useState('');
  const [optionValues, setOptionValues] = useState<Record<string, string>>({});
  const claim = useMutation({
    mutationFn: () =>
      submitClaim(
        campaignId,
        {
          addressId: addressId || addresses.data?.find((address) => address.isDefault)?.id || '',
          optionValues,
          ...(gift.data?.claim ? { version: gift.data.claim.version } : {}),
        },
        crypto.randomUUID(),
      ),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['me', 'entitlements'] }),
        queryClient.invalidateQueries({ queryKey: ['me', 'campaigns', campaignId] }),
        queryClient.invalidateQueries({ queryKey: ['me', 'claims'] }),
      ]);
      window.location.assign(`/claims/${result.id}`);
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    claim.mutate();
  };
  if (gift.isPending) return <p className="page-state">Loading gift…</p>;
  if (!gift.data) return <p className="page-state page-error">Gift could not be loaded.</p>;
  const canClaim =
    gift.data.displayState === 'WAITING_TO_CLAIM' || gift.data.displayState === 'CANCELLED';
  return (
    <section className="page-content">
      <p className="section-kicker">GIFT DETAIL</p>
      <div className="title-row">
        <div>
          <h1>{gift.data.campaign.title}</h1>
          <p className="lede">{gift.data.campaign.description}</p>
        </div>
        <span className="role-chip">{gift.data.displayState.replaceAll('_', ' ')}</span>
      </div>
      <div className="gift-detail-grid">
        <section className="panel campaign-editor">
          <p className="panel-label">YOUR PACKAGES</p>
          <ul className="record-list">
            {gift.data.entitlements.map((entitlement) => (
              <li key={entitlement.id}>
                <strong>{entitlement.giftPackage.name}</strong>
                <span>{entitlement.tier}</span>
              </li>
            ))}
          </ul>
          <p className="muted">
            Claim deadline: {new Date(gift.data.campaign.claimDeadlineAt).toLocaleString()}
          </p>
          {gift.data.claim ? (
            <Link className="button button-small" to={`/claims/${gift.data.claim.id}`}>
              Open claim {gift.data.claim.status.toLowerCase()}
            </Link>
          ) : null}
        </section>
        {canClaim ? (
          <form className="panel campaign-editor campaign-form" onSubmit={submit}>
            <p className="panel-label">CLAIM FORM</p>
            <h2>{gift.data.claim ? 'Resubmit gift' : 'Claim this gift'}</h2>
            {addresses.data?.length ? (
              <label>
                Delivery address
                <select
                  required
                  value={addressId || addresses.data.find((address) => address.isDefault)?.id || ''}
                  onChange={(event) => setAddressId(event.target.value)}
                >
                  {addresses.data.map((address) => (
                    <option key={address.id} value={address.id}>
                      {address.label} · {address.payload.recipientName}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="form-message form-error">
                Add a delivery address on your{' '}
                <Link className="card-link" to="/account">
                  account page
                </Link>{' '}
                first.
              </p>
            )}
            {gift.data.campaign.claimFormSchema.map((field) => (
              <label key={field.key}>
                {field.label}
                {field.type === 'SELECT' ? (
                  <select
                    required={field.required}
                    value={optionValues[field.key] ?? ''}
                    onChange={(event) =>
                      setOptionValues((current) => ({
                        ...current,
                        [field.key]: event.target.value,
                      }))
                    }
                  >
                    <option value="">Select</option>
                    {field.options?.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : field.type === 'LONG_TEXT' ? (
                  <textarea
                    required={field.required}
                    rows={4}
                    value={optionValues[field.key] ?? ''}
                    onChange={(event) =>
                      setOptionValues((current) => ({
                        ...current,
                        [field.key]: event.target.value,
                      }))
                    }
                  />
                ) : (
                  <input
                    required={field.required}
                    value={optionValues[field.key] ?? ''}
                    onChange={(event) =>
                      setOptionValues((current) => ({
                        ...current,
                        [field.key]: event.target.value,
                      }))
                    }
                  />
                )}
              </label>
            ))}
            <button
              className="button"
              disabled={claim.isPending || !addresses.data?.length}
              type="submit"
            >
              {gift.data.claim ? 'Resubmit claim' : 'Submit claim'}
            </button>
            {claim.isError ? (
              <p className="form-message form-error">{claim.error.message}</p>
            ) : null}
          </form>
        ) : null}
      </div>
    </section>
  );
}
