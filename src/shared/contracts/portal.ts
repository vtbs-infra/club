import { Type, type Static } from '@sinclair/typebox';

import { AnnouncementSeveritySchema } from './announcements.js';
import { CalendarMonthSchema, DateTimeSchema, IdSchema, Nullable } from './common.js';

export const PortalReleaseSchema = Type.Object({
  claimDeadlineAt: DateTimeSchema,
  claimStartAt: DateTimeSchema,
  coverImageUrl: Nullable(Type.String()),
  creatorName: Type.String(),
  description: Type.String(),
  eligibilityMonth: CalendarMonthSchema,
  id: IdSchema,
  title: Type.String(),
});
export type PortalRelease = Static<typeof PortalReleaseSchema>;

export const PortalAnnouncementSchema = Type.Object({
  id: IdSchema,
  pinned: Type.Boolean(),
  publishedAt: DateTimeSchema,
  severity: AnnouncementSeveritySchema,
  summary: Type.String(),
  title: Type.String(),
});
export type PortalAnnouncement = Static<typeof PortalAnnouncementSchema>;

export const PortalHomeSchema = Type.Object({
  announcements: Type.Array(PortalAnnouncementSchema),
  releases: Type.Array(PortalReleaseSchema),
});
export type PortalHome = Static<typeof PortalHomeSchema>;
