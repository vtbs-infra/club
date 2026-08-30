import type { Announcement, AnnouncementContent } from '../../shared/contracts/announcements';
import { apiRequest } from './http';

export type { Announcement, AnnouncementContent };

export function getAnnouncements(limit?: number): Promise<readonly Announcement[]> {
  return apiRequest(`/api/v1/me/announcements${limit ? `?limit=${limit}` : ''}`);
}

export function markAnnouncementRead(announcementId: string): Promise<void> {
  return apiRequest(`/api/v1/me/announcements/${announcementId}/read`, {
    body: JSON.stringify({}),
    method: 'POST',
  });
}

export function getManagedAnnouncements(
  area: 'admin' | 'creator',
): Promise<readonly Announcement[]> {
  return apiRequest(`/api/v1/${area}/announcements`);
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
