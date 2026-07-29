import { Type, type Static } from '@sinclair/typebox';

import { DateTimeSchema, IdSchema, Nullable } from './common.js';

const SummarySchema = Nullable(Type.Record(Type.String(), Type.Unknown()));

export const AuditLogSchema = Type.Object({
  action: Type.String(),
  actorEmail: Nullable(Type.String({ format: 'email' })),
  actorName: Nullable(Type.String()),
  actorUserId: Nullable(IdSchema),
  afterSummary: SummarySchema,
  beforeSummary: SummarySchema,
  createdAt: DateTimeSchema,
  creatorId: Nullable(IdSchema),
  id: IdSchema,
  reason: Nullable(Type.String()),
  requestId: Nullable(Type.String()),
  targetId: Type.String(),
  targetType: Type.String(),
});

export const AuditLogPageSchema = Type.Object({
  items: Type.Array(AuditLogSchema),
  nextBefore: Nullable(DateTimeSchema),
});
export type AuditLogPage = Static<typeof AuditLogPageSchema>;
