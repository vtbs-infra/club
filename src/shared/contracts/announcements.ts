import { Type, type Static } from '@sinclair/typebox';

import { DateTimeSchema, IdSchema, Nullable } from './common.js';

export const AnnouncementSeveritySchema = Type.Union([
  Type.Literal('INFO'),
  Type.Literal('WARNING'),
  Type.Literal('CRITICAL'),
]);

export const AnnouncementStatusSchema = Type.Union([
  Type.Literal('DRAFT'),
  Type.Literal('PUBLISHED'),
  Type.Literal('WITHDRAWN'),
]);

export const AnnouncementContentSchema = Type.Object(
  {
    body: Type.String({ maxLength: 20_000, minLength: 1 }),
    expiresAt: Type.Optional(Nullable(DateTimeSchema)),
    pinned: Type.Boolean(),
    publicVisible: Type.Boolean(),
    severity: AnnouncementSeveritySchema,
    title: Type.String({ maxLength: 200, minLength: 1 }),
  },
  { additionalProperties: false },
);

export const AnnouncementContentUpdateSchema = Type.Object(
  {
    ...AnnouncementContentSchema.properties,
    expectedVersion: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export const AnnouncementVersionCommandSchema = Type.Object(
  { expectedVersion: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);

export const AnnouncementSchema = Type.Object({
  body: Type.String(),
  createdAt: DateTimeSchema,
  expiresAt: Nullable(DateTimeSchema),
  id: IdSchema,
  pinned: Type.Boolean(),
  publicVisible: Type.Boolean(),
  publishedAt: Nullable(DateTimeSchema),
  read: Type.Optional(Type.Boolean()),
  scope: Type.Union([Type.Literal('PLATFORM'), Type.Literal('CREATOR')]),
  severity: AnnouncementSeveritySchema,
  status: AnnouncementStatusSchema,
  title: Type.String(),
  updatedAt: DateTimeSchema,
  version: Type.Integer({ minimum: 1 }),
  withdrawnAt: Nullable(DateTimeSchema),
});
export type Announcement = Static<typeof AnnouncementSchema>;
export type AnnouncementContent = Static<typeof AnnouncementContentSchema>;

export const AnnouncementSummarySchema = Type.Omit(AnnouncementSchema, ['body']);
export type AnnouncementSummary = Static<typeof AnnouncementSummarySchema>;

export const AnnouncementSummaryPageSchema = Type.Object({
  items: Type.Array(AnnouncementSummarySchema),
  nextCursor: Nullable(Type.String()),
});
export type AnnouncementSummaryPage = Static<typeof AnnouncementSummaryPageSchema>;
