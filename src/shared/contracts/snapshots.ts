import { Type, type Static } from '@sinclair/typebox';

import { DateTimeSchema, GuardTierSchema, IdSchema, Nullable } from './common.js';

export const SnapshotRunStatusSchema = Type.Union([
  Type.Literal('SCHEDULED'),
  Type.Literal('RUNNING'),
  Type.Literal('FAILED'),
  Type.Literal('PENDING_APPROVAL'),
  Type.Literal('FINALIZED'),
  Type.Literal('REJECTED'),
  Type.Literal('CANCELLED'),
]);

export const SnapshotRunSchema = Type.Object({
  acceptedAttemptId: Nullable(IdSchema),
  approvedAt: Nullable(DateTimeSchema),
  approvedBy: Nullable(IdSchema),
  createdAt: DateTimeSchema,
  creatorBilibiliUid: Type.String(),
  creatorId: IdSchema,
  creatorRoomId: Type.String(),
  cutoffTimezone: Type.String(),
  finalizedAt: Nullable(DateTimeSchema),
  id: IdSchema,
  onTimeWindowEndAt: DateTimeSchema,
  periodStart: Type.String({ format: 'date' }),
  scheduledCutoffAt: DateTimeSchema,
  status: SnapshotRunStatusSchema,
  updatedAt: DateTimeSchema,
});
export type SnapshotRun = Static<typeof SnapshotRunSchema>;

export const SnapshotAttemptSchema = Type.Object({
  attemptNumber: Type.Integer({ minimum: 1 }),
  captureCompletedAt: Nullable(DateTimeSchema),
  captureStartedAt: Nullable(DateTimeSchema),
  consistencyStatus: Type.Union([
    Type.Literal('PENDING'),
    Type.Literal('CONSISTENT'),
    Type.Literal('INCONSISTENT'),
  ]),
  createdAt: DateTimeSchema,
  declaredTotal: Nullable(Type.Integer({ minimum: 0 })),
  failureCode: Nullable(Type.String()),
  failureMessage: Nullable(Type.String()),
  id: IdSchema,
  normalizedTotal: Nullable(Type.Integer({ minimum: 0 })),
  punctuality: Nullable(Type.Union([Type.Literal('ON_TIME'), Type.Literal('LATE')])),
  schedulerStartedAt: DateTimeSchema,
  snapshotRunId: IdSchema,
  sourceName: Type.String(),
  sourceVersion: Type.String(),
});

export const SnapshotPageSchema = Type.Object({
  compressedSize: Type.Integer({ minimum: 0 }),
  contentEncoding: Type.String(),
  contentHashSha256: Type.String(),
  createdAt: DateTimeSchema,
  fetchedAt: DateTimeSchema,
  id: IdSchema,
  itemCount: Type.Integer({ minimum: 0 }),
  objectKey: Type.String(),
  pageNumber: Type.Integer({ minimum: 1 }),
  snapshotAttemptId: IdSchema,
  uncompressedSize: Type.Integer({ minimum: 0 }),
});

export const SnapshotMemberSchema = Type.Object({
  biliUid: Type.String(),
  createdAt: DateTimeSchema,
  displayNameAtSnapshot: Nullable(Type.String()),
  id: IdSchema,
  rawTier: Type.String(),
  snapshotRunId: IdSchema,
  sourcePosition: Type.Integer({ minimum: 1 }),
  tier: GuardTierSchema,
});

export const SnapshotDetailSchema = Type.Object({
  attempts: Type.Array(SnapshotAttemptSchema),
  members: Type.Array(SnapshotMemberSchema),
  pages: Type.Array(SnapshotPageSchema),
  run: SnapshotRunSchema,
});
export type SnapshotDetail = Static<typeof SnapshotDetailSchema>;

export const CreatorSnapshotDetailSchema = Type.Object({
  attempts: Type.Array(
    Type.Pick(SnapshotAttemptSchema, [
      'attemptNumber',
      'captureCompletedAt',
      'captureStartedAt',
      'consistencyStatus',
      'declaredTotal',
      'failureCode',
      'failureMessage',
      'normalizedTotal',
      'punctuality',
    ]),
  ),
  run: SnapshotRunSchema,
});

export const AdminSnapshotSchema = Type.Object({
  creator: Type.Object({ displayName: Type.String(), id: IdSchema }),
  run: SnapshotRunSchema,
});
export type AdminSnapshot = Static<typeof AdminSnapshotSchema>;

export const SnapshotIntegrityResultSchema = Type.Object({
  objectKey: Type.String(),
  ok: Type.Boolean(),
  pageNumber: Type.Integer({ minimum: 1 }),
  snapshotAttemptId: IdSchema,
});
export type SnapshotIntegrityResult = Static<typeof SnapshotIntegrityResultSchema>;
