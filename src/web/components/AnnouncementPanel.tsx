import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { listMyAnnouncements, markAnnouncementRead, type Announcement } from '../api/announcements';
import { getMyEntitlements } from '../api/campaigns';
import { getClaims } from '../api/claims';

interface PriorityItem {
  readonly detail: string;
  readonly href: string;
  readonly id: string;
  readonly kind: string;
  readonly score: number;
  readonly title: string;
}

function announcementPriority(item: Announcement): number {
  if (!item.readAt && (item.scope === 'CREATOR' || item.scope === 'CAMPAIGN')) return 500;
  if (item.scope === 'PLATFORM' && item.pinned) return 450;
  if (!item.readAt) return 350;
  return 100;
}

export function AnnouncementPanel() {
  const queryClient = useQueryClient();
  const announcements = useQuery({
    queryFn: listMyAnnouncements,
    queryKey: ['me', 'announcements'],
    refetchInterval: 15_000,
  });
  const gifts = useQuery({ queryFn: getMyEntitlements, queryKey: ['me', 'entitlements'] });
  const claims = useQuery({ queryFn: getClaims, queryKey: ['me', 'claims'] });
  const read = useMutation({
    mutationFn: markAnnouncementRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['me', 'announcements'] }),
  });
  const priorityItems: PriorityItem[] = [
    ...(announcements.data ?? []).map((item) => ({
      detail: `${item.scope} · ${item.severity}`,
      href: '/announcements',
      id: `announcement:${item.id}`,
      kind: item.readAt ? 'NOTICE' : 'UNREAD',
      score: announcementPriority(item),
      title: item.title,
    })),
    ...(gifts.data ?? [])
      .filter((gift) => gift.displayState === 'WAITING_TO_CLAIM')
      .map((gift) => ({
        detail: `Claim by ${new Date(gift.campaign.claimDeadlineAt).toLocaleString()}`,
        href: `/gifts/${gift.campaign.id}`,
        id: `gift:${gift.campaign.id}`,
        kind: 'EXPIRING GIFT',
        score: 475,
        title: gift.campaign.title,
      })),
    ...(claims.data ?? [])
      .filter((claim) => claim.status === 'SHIPPED' || claim.status === 'PROCESSING')
      .map((claim) => ({
        detail: `Updated ${new Date(claim.updatedAt).toLocaleString()}`,
        href: `/claims/${claim.id}`,
        id: `claim:${claim.id}`,
        kind: claim.status === 'SHIPPED' ? 'SHIPMENT' : 'FULFILLMENT',
        score: claim.status === 'SHIPPED' ? 425 : 250,
        title: claim.claimNumber,
      })),
  ].sort((left, right) => right.score - left.score);

  return (
    <section className="panel account-section priority-panel">
      <div className="title-row compact-title">
        <div>
          <p className="panel-label">PRIORITY</p>
          <h2>What needs attention</h2>
        </div>
        <Link className="card-link" to="/announcements">
          All notices
        </Link>
      </div>
      {priorityItems.length === 0 ? (
        <p className="muted">No urgent gifts, shipments, or unread notices.</p>
      ) : (
        <ul className="record-list">
          {priorityItems.slice(0, 6).map((item) => (
            <li key={item.id}>
              <Link className="priority-link" to={item.href}>
                <span className="role-chip">{item.kind}</span>
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {(announcements.data ?? []).some((item) => !item.readAt) ? (
        <button
          className="button button-quiet"
          disabled={read.isPending}
          type="button"
          onClick={() => {
            const next = announcements.data?.find((item) => !item.readAt);
            if (next) read.mutate(next.id);
          }}
        >
          Mark top notice read
        </button>
      ) : null}
    </section>
  );
}
