import { SnapshotRunStatusSchema } from './snapshots.js';
import { Type, type Static } from '@sinclair/typebox';

import { DateTimeSchema, IdSchema, Nullable } from './common.js';
import { VerificationRoomHealthSchema } from './verification-rooms.js';

export const RuntimeStateSchema = Type.Union([
  Type.Literal('STARTING'),
  Type.Literal('RUNNING'),
  Type.Literal('DEGRADED'),
  Type.Literal('STOPPED'),
]);

export type RuntimeState = Static<typeof RuntimeStateSchema>;

export const RuntimeStatusSchema = Type.Object({
  lastErrorAt: Nullable(DateTimeSchema),
  lastErrorCode: Nullable(Type.String()),
  lastSuccessAt: Nullable(DateTimeSchema),
  lastTickAt: Nullable(DateTimeSchema),
  nextRetryAt: Nullable(DateTimeSchema),
  startedAt: Nullable(DateTimeSchema),
  state: RuntimeStateSchema,
});

export const SystemStatusSchema = Type.Object({
  checks: Type.Object({
    database: Type.Union([Type.Literal('ok'), Type.Literal('down')]),
    schema: Type.Union([Type.Literal('ok'), Type.Literal('down')]),
    storage: Type.Union([Type.Literal('ok'), Type.Literal('down')]),
  }),
  integrityWarnings: Type.Array(
    Type.Object({
      creatorId: IdSchema,
      pageId: IdSchema,
      runId: IdSchema,
    }),
  ),
  recentSnapshotFailures: Type.Array(
    Type.Object({
      createdAt: DateTimeSchema,
      creatorId: IdSchema,
      failureCode: Nullable(Type.String()),
      runId: IdSchema,
    }),
  ),
  rooms: Type.Array(
    Type.Object({
      displayName: Type.String(),
      enabled: Type.Boolean(),
      healthStatus: VerificationRoomHealthSchema,
      lastConnectedAt: Nullable(DateTimeSchema),
    }),
  ),
  runtimes: Type.Object({
    identity: RuntimeStatusSchema,
    media: RuntimeStatusSchema,
    roster: RuntimeStatusSchema,
  }),
  snapshotRunCounts: Type.Array(
    Type.Object({ status: SnapshotRunStatusSchema, value: Type.Integer({ minimum: 0 }) }),
  ),
  status: Type.Union([Type.Literal('ok'), Type.Literal('needs_setup'), Type.Literal('degraded')]),
  version: Type.String(),
});
export type SystemStatus = Static<typeof SystemStatusSchema>;
