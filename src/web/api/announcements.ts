import type {
  Announcement,
  AnnouncementContent,
  AnnouncementSummary,
  AnnouncementSummaryPage,
} from '../../shared/contracts/announcements';
import { apiRequest } from './http';

export type { Announcement, AnnouncementContent, AnnouncementSummary, AnnouncementSummaryPage };

function pageQuery(input: {
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}) {
  const parameters = new URLSearchParams();
  if (input.cursor) parameters.set('cursor', input.cursor);
  if (input.limit) parameters.set('limit', String(input.limit));
  const query = parameters.toString();
  return query ? `?${query}` : '';
}

export function getAnnouncements(
  input: {
    readonly cursor?: string | undefined;
    readonly limit?: number | undefined;
  } = {},
): Promise<AnnouncementSummaryPage> {
  return apiRequest(`/api/v1/me/announcements${pageQuery(input)}`);
}

export function getAnnouncement(announcementId: string): Promise<Announcement> {
  return apiRequest(`/api/v1/me/announcements/${announcementId}`);
}

export function markAnnouncementRead(announcementId: string): Promise<void> {
  return apiRequest(`/api/v1/me/announcements/${announcementId}/read`, {
    body: JSON.stringify({}),
    method: 'POST',
  });
}

export function getManagedAnnouncements(
  area: 'admin' | 'creator',
  input: { readonly cursor?: string | undefined; readonly limit?: number | undefined } = {},
): Promise<AnnouncementSummaryPage> {
  return apiRequest(`/api/v1/${area}/announcements${pageQuery(input)}`);
}

export function getManagedAnnouncement(
  area: 'admin' | 'creator',
  announcementId: string,
): Promise<Announcement> {
  return apiRequest(`/api/v1/${area}/announcements/${announcementId}`);
}

export function createManagedAnnouncement(
  area: 'admin' | 'creator',
  input: AnnouncementContent,
): Promise<Announcement> {
  return apiRequest(`/api/v1/${area}/announcements`, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function saveManagedAnnouncement(
  area: 'admin' | 'creator',
  announcementId: string,
  input: AnnouncementContent & { readonly expectedVersion: number },
): Promise<Announcement> {
  return apiRequest(`/api/v1/${area}/announcements/${announcementId}`, {
    body: JSON.stringify(input),
    method: 'PUT',
  });
}

export function publishManagedAnnouncement(
  area: 'admin' | 'creator',
  announcementId: string,
  expectedVersion: number,
): Promise<Announcement> {
  return apiRequest(`/api/v1/${area}/announcements/${announcementId}/publish`, {
    body: JSON.stringify({ expectedVersion }),
    method: 'POST',
  });
}

export function withdrawManagedAnnouncement(
  area: 'admin' | 'creator',
  announcementId: string,
  expectedVersion: number,
): Promise<Announcement> {
  return apiRequest(`/api/v1/${area}/announcements/${announcementId}/withdraw`, {
    body: JSON.stringify({ expectedVersion }),
    method: 'POST',
  });
}

export function deleteManagedAnnouncement(
  area: 'admin' | 'creator',
  announcementId: string,
): Promise<void> {
  return apiRequest(`/api/v1/${area}/announcements/${announcementId}`, {
    method: 'DELETE',
  });
}
