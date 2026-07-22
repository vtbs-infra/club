import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Navigate, useParams } from 'react-router-dom';

import {
  createCampaign,
  getCampaign,
  getCampaigns,
  transitionCampaign,
  updateCampaign,
  type CampaignDetail,
  type ClaimField,
  type FulfillmentMode,
} from '../api/campaigns';
import { getCreators, type Membership } from '../api/identity';
import { AuthenticatedPage } from '../components/AuthenticatedPage';

const tiers = ['CAPTAIN', 'ADMIRAL', 'GOVERNOR'] as const;

function localInput(date: string) {
  const value = new Date(date);
  const shifted = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function defaultDates() {
  const start = new Date();
  start.setSeconds(0, 0);
  const deadline = new Date(start.getTime() + 30 * 24 * 60 * 60_000);
  return { deadline: localInput(deadline.toISOString()), start: localInput(start.toISOString()) };
}

function formatFields(fields: readonly ClaimField[]) {
  return fields
    .map((field) =>
      [
        field.key,
        field.label,
        field.type,
        field.required ? 'required' : 'optional',
        field.options?.join(',') ?? '',
      ].join('|'),
    )
    .join('\n');
}

function parseFields(value: string): ClaimField[] {
  if (!value.trim()) return [];
  return value
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const [key = '', label = '', rawType = 'TEXT', required = 'optional', rawOptions = ''] =
        line.split('|');
      const type = rawType.trim() as ClaimField['type'];
      return {
        key: key.trim(),
        label: label.trim(),
        ...(type === 'SELECT'
          ? {
              options: rawOptions
                .split(',')
                .map((option) => option.trim())
                .filter(Boolean),
            }
          : {}),
        required: required.trim().toLowerCase() === 'required',
        type,
      };
    });
}

export function CampaignsPage() {
  const { organizationId = '' } = useParams();
  return (
    <AuthenticatedPage>
      {(identity) => {
        const membership = identity.memberships.find(
          (candidate) => candidate.organization.id === organizationId,
        );
        return membership ? (
          <CampaignWorkspace membership={membership} organizationId={organizationId} />
        ) : (
          <Navigate replace to="/organizations" />
        );
      }}
    </AuthenticatedPage>
  );
}

function CampaignWorkspace({
  membership,
  organizationId,
}: {
  membership: Membership;
  organizationId: string;
}) {
  const queryClient = useQueryClient();
  const creators = useQuery({
    queryFn: () => getCreators(organizationId),
    queryKey: ['organizations', organizationId, 'creators'],
  });
  const campaigns = useQuery({
    queryFn: () => getCampaigns(organizationId),
    queryKey: ['organizations', organizationId, 'campaigns'],
  });
  const [selectedId, setSelectedId] = useState('');
  const activeId = selectedId || campaigns.data?.[0]?.id || '';
  const detail = useQuery({
    enabled: Boolean(activeId),
    queryFn: () => getCampaign(activeId),
    queryKey: ['campaigns', activeId],
  });
  const canManage = ['OWNER', 'ADMIN', 'OPERATOR'].includes(membership.role);

  const refresh = async (campaignId?: string) => {
    await queryClient.invalidateQueries({
      queryKey: ['organizations', organizationId, 'campaigns'],
    });
    if (campaignId) await queryClient.invalidateQueries({ queryKey: ['campaigns', campaignId] });
  };

  return (
    <section className="page-content">
      <div className="title-row">
        <div>
          <p className="section-kicker">GIFT OPERATIONS</p>
          <h1>Monthly campaigns</h1>
          <p className="lede">Publish deterministic gift rules and follow entitlement progress.</p>
        </div>
        <span className="role-chip">{membership.role}</span>
      </div>
      {canManage ? (
        <CreateCampaignForm
          creators={creators.data ?? []}
          onCreated={async (id) => {
            setSelectedId(id);
            await refresh(id);
          }}
          organizationId={organizationId}
        />
      ) : null}
      <div className="campaign-layout">
        <aside className="panel campaign-list">
          <p className="panel-label">CAMPAIGNS</p>
          {campaigns.isPending ? <p className="muted">Loading campaigns…</p> : null}
          {campaigns.data?.length === 0 ? (
            <p className="muted">No campaign has been created.</p>
          ) : null}
          {campaigns.data?.map((campaign) => (
            <button
              className={
                campaign.id === activeId ? 'campaign-list-item selected' : 'campaign-list-item'
              }
              key={campaign.id}
              onClick={() => setSelectedId(campaign.id)}
              type="button"
            >
              <strong>{campaign.title}</strong>
              <span>
                {campaign.periodStart.slice(0, 7)} · {campaign.status}
              </span>
              <small>{campaign.entitlementCount} entitlements</small>
            </button>
          ))}
        </aside>
        <div>
          {detail.isPending && activeId ? <p className="muted">Loading editor…</p> : null}
          {detail.data ? (
            <CampaignEditor
              campaign={detail.data}
              canManage={canManage}
              key={detail.data.id}
              onChanged={() => refresh(detail.data.id)}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function CreateCampaignForm({
  creators,
  onCreated,
  organizationId,
}: {
  readonly creators: readonly { readonly displayName: string; readonly id: string }[];
  readonly onCreated: (id: string) => Promise<void>;
  readonly organizationId: string;
}) {
  const dates = defaultDates();
  const [creatorId, setCreatorId] = useState('');
  const [title, setTitle] = useState('');
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [start, setStart] = useState(dates.start);
  const [deadline, setDeadline] = useState(dates.deadline);
  const mutation = useMutation({
    mutationFn: () =>
      createCampaign(organizationId, {
        claimDeadlineAt: new Date(deadline).toISOString(),
        claimFormSchema: [],
        claimStartAt: new Date(start).toISOString(),
        creatorId,
        description: '',
        fulfillmentMode: 'HIGHEST_ONLY',
        periodStart: `${period}-01`,
        title,
      }),
    onSuccess: (campaign) => onCreated(campaign.id),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };
  return (
    <form className="panel campaign-create campaign-form" onSubmit={submit}>
      <div>
        <p className="panel-label">NEW CAMPAIGN</p>
        <h2>Start a monthly gift</h2>
      </div>
      <label>
        Creator
        <select required value={creatorId} onChange={(event) => setCreatorId(event.target.value)}>
          <option value="">Select creator</option>
          {creators.map((creator) => (
            <option key={creator.id} value={creator.id}>
              {creator.displayName}
            </option>
          ))}
        </select>
      </label>
      <label>
        Period
        <input
          required
          type="month"
          value={period}
          onChange={(event) => setPeriod(event.target.value)}
        />
      </label>
      <label>
        Title
        <input required value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        Claim opens
        <input
          required
          type="datetime-local"
          value={start}
          onChange={(event) => setStart(event.target.value)}
        />
      </label>
      <label>
        Claim deadline
        <input
          required
          type="datetime-local"
          value={deadline}
          onChange={(event) => setDeadline(event.target.value)}
        />
      </label>
      <button className="button button-small" disabled={mutation.isPending} type="submit">
        Create draft
      </button>
      {mutation.isError ? (
        <p className="form-message form-error">{mutation.error.message}</p>
      ) : null}
    </form>
  );
}

function CampaignEditor({
  campaign,
  canManage,
  onChanged,
}: {
  readonly campaign: CampaignDetail;
  readonly canManage: boolean;
  readonly onChanged: () => Promise<void>;
}) {
  const [title, setTitle] = useState(campaign.title);
  const [description, setDescription] = useState(campaign.description);
  const [deadline, setDeadline] = useState(localInput(campaign.claimDeadlineAt));
  const [mode, setMode] = useState<FulfillmentMode>(campaign.fulfillmentMode);
  const [fields, setFields] = useState(formatFields(campaign.claimFormSchema));
  const [packageRows, setPackageRows] = useState(() =>
    tiers.map((tier) => {
      const rule = campaign.tierRules.find((candidate) => candidate.tier === tier);
      const giftPackage = campaign.packages.find(
        (candidate) => candidate.id === rule?.giftPackageId,
      );
      return {
        enabled: Boolean(giftPackage),
        item: giftPackage?.items[0]?.name ?? '',
        name: giftPackage?.name ?? `${tier[0]}${tier.slice(1).toLowerCase()} gift`,
        quantity: giftPackage?.items[0]?.quantity ?? 1,
        tier,
      };
    }),
  );
  const save = useMutation({
    mutationFn: () =>
      updateCampaign(campaign.id, {
        claimDeadlineAt: new Date(deadline).toISOString(),
        description,
        title,
        ...(campaign.status === 'DRAFT'
          ? {
              claimFormSchema: parseFields(fields),
              composition: {
                packages: packageRows
                  .filter((row) => row.enabled)
                  .map((row) => ({
                    description: '',
                    items: [{ description: '', name: row.item, quantity: row.quantity }],
                    key: row.tier.toLowerCase(),
                    name: row.name,
                  })),
                tierRules: packageRows
                  .filter((row) => row.enabled)
                  .map((row) => ({
                    packageKey: row.tier.toLowerCase(),
                    tier: row.tier,
                  })),
              },
              fulfillmentMode: mode,
            }
          : {}),
      }),
    onSuccess: onChanged,
  });
  const transition = useMutation({
    mutationFn: (action: 'archive' | 'close' | 'publish') =>
      transitionCampaign(campaign.id, action),
    onSuccess: onChanged,
  });
  return (
    <section className="panel campaign-editor campaign-form">
      <div className="title-row compact-title">
        <div>
          <p className="panel-label">{campaign.periodStart.slice(0, 7)}</p>
          <h2>{campaign.title}</h2>
        </div>
        <span className="role-chip">{campaign.status}</span>
      </div>
      <div className="progress-strip">
        <div>
          <strong>{campaign.progress.active}</strong>
          <span>Active</span>
        </div>
        <div>
          <strong>{campaign.progress.revoked}</strong>
          <span>Revoked</span>
        </div>
        <div>
          <strong>{campaign.progress.total}</strong>
          <span>Total</span>
        </div>
      </div>
      <label>
        Title
        <input
          disabled={!canManage}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label>
        Description
        <textarea
          disabled={!canManage}
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <label>
        Claim deadline
        <input
          disabled={!canManage}
          type="datetime-local"
          value={deadline}
          onChange={(event) => setDeadline(event.target.value)}
        />
      </label>
      <label>
        Gift behavior
        <select
          disabled={!canManage || campaign.status !== 'DRAFT'}
          value={mode}
          onChange={(event) => setMode(event.target.value as FulfillmentMode)}
        >
          <option value="HIGHEST_ONLY">Highest tier only</option>
          <option value="CUMULATIVE">Cumulative tiers</option>
        </select>
      </label>
      <fieldset disabled={!canManage || campaign.status !== 'DRAFT'}>
        <legend>Packages and tier rules</legend>
        {packageRows.map((row, index) => (
          <div className="tier-editor" key={row.tier}>
            <label className="checkbox-label">
              <input
                checked={row.enabled}
                type="checkbox"
                onChange={(event) =>
                  setPackageRows((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, enabled: event.target.checked } : item,
                    ),
                  )
                }
              />
              {row.tier}
            </label>
            <input
              aria-label={`${row.tier} package name`}
              disabled={!row.enabled}
              value={row.name}
              onChange={(event) =>
                setPackageRows((current) =>
                  current.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, name: event.target.value } : item,
                  ),
                )
              }
            />
            <input
              aria-label={`${row.tier} item name`}
              disabled={!row.enabled}
              placeholder="Item name"
              value={row.item}
              onChange={(event) =>
                setPackageRows((current) =>
                  current.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, item: event.target.value } : item,
                  ),
                )
              }
            />
            <input
              aria-label={`${row.tier} quantity`}
              disabled={!row.enabled}
              min="1"
              type="number"
              value={row.quantity}
              onChange={(event) =>
                setPackageRows((current) =>
                  current.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, quantity: Number(event.target.value) } : item,
                  ),
                )
              }
            />
          </div>
        ))}
      </fieldset>
      <label>
        Claim fields{' '}
        <small>
          One per line: key|label|TEXT, LONG_TEXT or SELECT|required or optional|select options
        </small>
        <textarea
          disabled={!canManage || campaign.status !== 'DRAFT'}
          placeholder="size|T-shirt size|SELECT|required|S,M,L"
          rows={4}
          value={fields}
          onChange={(event) => setFields(event.target.value)}
        />
      </label>
      {canManage ? (
        <div className="button-row">
          <button
            className="button button-small"
            disabled={save.isPending}
            onClick={() => save.mutate()}
            type="button"
          >
            Save changes
          </button>
          {campaign.status === 'DRAFT' ? (
            <button
              className="button button-small button-secondary"
              disabled={transition.isPending}
              onClick={() => transition.mutate('publish')}
              type="button"
            >
              Publish
            </button>
          ) : null}
          {campaign.status === 'PUBLISHED' ? (
            <button
              className="button button-small button-secondary"
              onClick={() => transition.mutate('close')}
              type="button"
            >
              Close
            </button>
          ) : null}
          {campaign.status === 'CLOSED' ? (
            <button
              className="button button-small button-secondary"
              onClick={() => transition.mutate('archive')}
              type="button"
            >
              Archive
            </button>
          ) : null}
        </div>
      ) : null}
      {save.isError || transition.isError ? (
        <p className="form-message form-error">
          {save.error?.message ?? transition.error?.message}
        </p>
      ) : null}
    </section>
  );
}
