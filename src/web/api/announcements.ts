import type { Announcement, ManagedAnnouncementInput } from '../../shared/contracts/announcements';
import { apiRequest } from './http';

export type { Announcement, ManagedAnnouncementInput };

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
  input: ManagedAnnouncementInput,
): Promise<Announcement> {
  return apiRequest(`/api/v1/${area}/announcements`, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function updateManagedAnnouncement(
  area: 'admin' | 'creator',
  announcementId: string,
  input: ManagedAnnouncementInput & { readonly expectedVersion: number },
): Promise<Announcement> {
  return apiRequest(`/api/v1/${area}/announcements/${announcementId}`, {
    body: JSON.stringify(input),
    method: 'PUT',
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
