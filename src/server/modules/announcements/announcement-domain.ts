import { AppError } from '../../../shared/errors/app-error.js';

export const ANNOUNCEMENT_SCOPES = ['PLATFORM', 'ORGANIZATION', 'CREATOR', 'CAMPAIGN'] as const;
export const ANNOUNCEMENT_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const;

export type AnnouncementScope = (typeof ANNOUNCEMENT_SCOPES)[number];
export type AnnouncementSeverity = (typeof ANNOUNCEMENT_SEVERITIES)[number];

export function announcementVisibleToUser(
  announcement: {
    readonly campaignId: string | null;
    readonly creatorId: string | null;
    readonly organizationId: string | null;
    readonly scope: AnnouncementScope;
  },
  access: {
    readonly campaignIds: ReadonlySet<string>;
    readonly creatorIds: ReadonlySet<string>;
    readonly organizationIds: ReadonlySet<string>;
  },
) {
  if (announcement.scope === 'PLATFORM') return true;
  if (announcement.organizationId && access.organizationIds.has(announcement.organizationId)) {
    return true;
  }
  if (announcement.scope === 'CREATOR') {
    return Boolean(announcement.creatorId && access.creatorIds.has(announcement.creatorId));
  }
  if (announcement.scope === 'CAMPAIGN') {
    return Boolean(announcement.campaignId && access.campaignIds.has(announcement.campaignId));
  }
  return false;
}

export function validateAnnouncementContent(input: {
  readonly body: string;
  readonly expiresAt: Date | null;
  readonly publishedAt: Date | null;
  readonly title: string;
}) {
  if (!input.title.trim() || input.title.length > 160) {
    throw new AppError('ANNOUNCEMENT_TITLE_INVALID', 'Announcement title is invalid.', 400);
  }
  if (!input.body.trim() || input.body.length > 10_000) {
    throw new AppError('ANNOUNCEMENT_BODY_INVALID', 'Announcement body is invalid.', 400);
  }
  if (
    input.expiresAt &&
    input.publishedAt &&
    input.expiresAt.getTime() <= input.publishedAt.getTime()
  ) {
    throw new AppError(
      'ANNOUNCEMENT_WINDOW_INVALID',
      'Announcement expiry must be after publication.',
      400,
    );
  }
}
