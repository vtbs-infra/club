import { apiRequest } from './http';

export type AnnouncementScope = 'PLATFORM' | 'ORGANIZATION' | 'CREATOR' | 'CAMPAIGN';
export type AnnouncementSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface Announcement {
  readonly body: string;
  readonly campaignId: string | null;
  readonly createdAt: string;
  readonly creatorId: string | null;
  readonly expiresAt: string | null;
  readonly id: string;
  readonly organizationId: string | null;
  readonly pinned: boolean;
  readonly publishedAt: string | null;
  readonly readAt: string | null;
  readonly scope: AnnouncementScope;
  readonly severity: AnnouncementSeverity;
  readonly title: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface AnnouncementDraft {
  readonly body: string;
  readonly campaignId?: string | null;
  readonly creatorId?: string | null;
  readonly expiresAt?: string | null;
  readonly pinned: boolean;
  readonly publishedAt?: string | null;
  readonly scope: AnnouncementScope;
  readonly severity: AnnouncementSeverity;
  readonly title: string;
}

export const listMyAnnouncements = () => apiRequest<Announcement[]>('/api/v1/me/announcements');

export const markAnnouncementRead = (announcementId: string) =>
  apiRequest<{ readonly announcementId: string; readonly readAt: string }>(
    `/api/v1/me/announcements/${announcementId}/read`,
    { body: '{}', method: 'POST' },
  );

export const listOrganizationAnnouncements = (organizationId: string) =>
  apiRequest<Announcement[]>(`/api/v1/organizations/${organizationId}/announcements`);

export const createOrganizationAnnouncement = (organizationId: string, input: AnnouncementDraft) =>
  apiRequest<Announcement>(`/api/v1/organizations/${organizationId}/announcements`, {
    body: JSON.stringify(input),
    method: 'POST',
  });

export const listPlatformAnnouncements = () =>
  apiRequest<Announcement[]>('/api/v1/platform/announcements');

export const createPlatformAnnouncement = (
  input: Omit<AnnouncementDraft, 'campaignId' | 'creatorId' | 'scope'>,
) =>
  apiRequest<Announcement>('/api/v1/platform/announcements', {
    body: JSON.stringify(input),
    method: 'POST',
  });

export const updateAnnouncement = (
  announcementId: string,
  input: Partial<
    Pick<AnnouncementDraft, 'body' | 'expiresAt' | 'pinned' | 'publishedAt' | 'severity' | 'title'>
  > & { readonly version: number },
) =>
  apiRequest<Announcement>(`/api/v1/announcements/${announcementId}`, {
    body: JSON.stringify(input),
    method: 'PATCH',
  });
