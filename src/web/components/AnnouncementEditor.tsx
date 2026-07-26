import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import {
  createOrganizationAnnouncement,
  createPlatformAnnouncement,
  listOrganizationAnnouncements,
  listPlatformAnnouncements,
  updateAnnouncement,
  type AnnouncementDraft,
  type AnnouncementScope,
  type AnnouncementSeverity,
} from '../api/announcements';
import { getCampaigns } from '../api/campaigns';
import { getCreators } from '../api/identity';

interface AnnouncementEditorProperties {
  readonly organizationId?: string;
}

export function AnnouncementEditor({ organizationId }: AnnouncementEditorProperties) {
  const platform = organizationId === undefined;
  const queryClient = useQueryClient();
  const queryKey = platform
    ? (['platform', 'announcements'] as const)
    : (['organizations', organizationId, 'announcements'] as const);
  const notices = useQuery({
    queryFn: platform
      ? listPlatformAnnouncements
      : () => listOrganizationAnnouncements(organizationId),
    queryKey,
    refetchInterval: 15_000,
  });
  const creators = useQuery({
    enabled: !platform,
    queryFn: () => getCreators(organizationId ?? ''),
    queryKey: ['organizations', organizationId, 'creators'],
  });
  const campaigns = useQuery({
    enabled: !platform,
    queryFn: () => getCampaigns(organizationId ?? ''),
    queryKey: ['organizations', organizationId, 'campaigns'],
  });
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [scope, setScope] = useState<AnnouncementScope>(platform ? 'PLATFORM' : 'ORGANIZATION');
  const [severity, setSeverity] = useState<AnnouncementSeverity>('INFO');
  const [targetId, setTargetId] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [pinned, setPinned] = useState(false);
  const [publishNow, setPublishNow] = useState(true);
  const refresh = async () => queryClient.invalidateQueries({ queryKey });
  const create = useMutation({
    mutationFn: async () => {
      const base = {
        body,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        pinned,
        publishedAt: publishNow ? new Date().toISOString() : null,
        severity,
        title,
      };
      if (platform) return createPlatformAnnouncement(base);
      const draft: AnnouncementDraft = {
        ...base,
        ...(scope === 'CREATOR' ? { creatorId: targetId } : {}),
        ...(scope === 'CAMPAIGN' ? { campaignId: targetId } : {}),
        scope,
      };
      return createOrganizationAnnouncement(organizationId, draft);
    },
    onSuccess: async () => {
      setTitle('');
      setBody('');
      setTargetId('');
      setExpiresAt('');
      setPinned(false);
      await refresh();
    },
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updateAnnouncement>[1] }) =>
      updateAnnouncement(id, input),
    onSuccess: refresh,
  });
  const targets = useMemo(() => {
    if (scope === 'CREATOR') {
      return creators.data?.map((item) => ({ id: item.id, label: item.displayName })) ?? [];
    }
    if (scope === 'CAMPAIGN') {
      return campaigns.data?.map((item) => ({ id: item.id, label: item.title })) ?? [];
    }
    return [];
  }, [campaigns.data, creators.data, scope]);
  const targetRequired = scope === 'CREATOR' || scope === 'CAMPAIGN';

  return (
    <div className="operations-layout">
      <form
        className="panel auth-form announcement-form"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <div>
          <p className="panel-label">NEW ANNOUNCEMENT</p>
          <h2>{platform ? 'Platform notice' : 'Audience notice'}</h2>
        </div>
        {!platform ? (
          <label>
            Scope
            <select
              value={scope}
              onChange={(event) => {
                setScope(event.target.value as AnnouncementScope);
                setTargetId('');
              }}
            >
              <option value="ORGANIZATION">Organization</option>
              <option value="CREATOR">Creator</option>
              <option value="CAMPAIGN">Campaign</option>
            </select>
          </label>
        ) : null}
        {targetRequired ? (
          <label>
            Target
            <select required value={targetId} onChange={(event) => setTargetId(event.target.value)}>
              <option value="">Choose a {scope.toLowerCase()}</option>
              {targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          Title
          <input
            maxLength={160}
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          Message
          <textarea
            maxLength={10_000}
            required
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <label>
          Severity
          <select
            value={severity}
            onChange={(event) => setSeverity(event.target.value as AnnouncementSeverity)}
          >
            <option value="INFO">Info</option>
            <option value="WARNING">Warning</option>
            <option value="CRITICAL">Critical</option>
          </select>
        </label>
        <label>
          Expires at
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
          />
        </label>
        <label className="checkbox-label">
          <input
            checked={pinned}
            type="checkbox"
            onChange={(event) => setPinned(event.target.checked)}
          />
          Pin this announcement
        </label>
        <label className="checkbox-label">
          <input
            checked={publishNow}
            type="checkbox"
            onChange={(event) => setPublishNow(event.target.checked)}
          />
          Publish immediately
        </label>
        <button
          className="button"
          disabled={create.isPending || !title || !body || (targetRequired && !targetId)}
          type="submit"
        >
          {publishNow ? 'Publish' : 'Save draft'}
        </button>
        {create.isError ? <p className="form-message form-error">{create.error.message}</p> : null}
      </form>
      <section className="announcement-list manager-list">
        {notices.data?.map((item) => (
          <article className="panel announcement-card" key={item.id}>
            <div className="title-row compact-title">
              <div>
                <div className="button-row">
                  <span className="role-chip">{item.scope}</span>
                  <span className="role-chip">{item.severity}</span>
                  <span className="role-chip">V{item.version}</span>
                </div>
                <h2>{item.title}</h2>
              </div>
              <span className={item.publishedAt ? 'status-active' : 'muted'}>
                {item.publishedAt ? 'PUBLISHED' : 'DRAFT'}
              </span>
            </div>
            <p>{item.body}</p>
            <div className="button-row">
              {!item.publishedAt ? (
                <button
                  className="button button-small"
                  disabled={update.isPending}
                  type="button"
                  onClick={() =>
                    update.mutate({
                      id: item.id,
                      input: { publishedAt: new Date().toISOString(), version: item.version },
                    })
                  }
                >
                  Publish
                </button>
              ) : null}
              <button
                className="button button-secondary button-small"
                disabled={update.isPending}
                type="button"
                onClick={() =>
                  update.mutate({
                    id: item.id,
                    input: { pinned: !item.pinned, version: item.version },
                  })
                }
              >
                {item.pinned ? 'Unpin' : 'Pin'}
              </button>
            </div>
          </article>
        ))}
        {notices.data?.length === 0 ? (
          <div className="panel empty-state">
            <h2>No announcements</h2>
            <p>Create a draft or publish the first notice.</p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
