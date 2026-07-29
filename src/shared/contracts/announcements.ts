import { Type, type Static } from '@sinclair/typebox';

import { DateTimeSchema, IdSchema, Nullable } from './common.js';

export const AnnouncementSeveritySchema = Type.Union([
  Type.Literal('INFO'),
  Type.Literal('WARNING'),
  Type.Literal('CRITICAL'),
]);

export const AnnouncementInputSchema = Type.Object(
  {
    body: Type.String({ maxLength: 20_000, minLength: 1 }),
    expiresAt: Type.Optional(Nullable(DateTimeSchema)),
    pinned: Type.Boolean(),
    publishNow: Type.Boolean(),
    severity: AnnouncementSeveritySchema,
    title: Type.String({ maxLength: 200, minLength: 1 }),
  },
  { additionalProperties: false },
);

export const AnnouncementUpdateSchema = Type.Intersect([
  AnnouncementInputSchema,
  Type.Object({ expectedVersion: Type.Integer({ minimum: 1 }) }),
]);

export const AnnouncementSchema = Type.Object({
  body: Type.String(),
  createdAt: DateTimeSchema,
  expiresAt: Nullable(DateTimeSchema),
  id: IdSchema,
  pinned: Type.Boolean(),
  publishedAt: Nullable(DateTimeSchema),
  read: Type.Optional(Type.Boolean()),
  scope: Type.Union([Type.Literal('PLATFORM'), Type.Literal('CREATOR')]),
  severity: AnnouncementSeveritySchema,
  title: Type.String(),
  updatedAt: DateTimeSchema,
  version: Type.Integer({ minimum: 1 }),
});
export type Announcement = Static<typeof AnnouncementSchema>;
export type ManagedAnnouncementInput = Static<typeof AnnouncementInputSchema>;
