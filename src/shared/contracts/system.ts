import { Type, type Static } from '@sinclair/typebox';

import { DateTimeSchema, IdSchema, Nullable } from './common.js';
import { VerificationRoomHealthSchema } from './verification-rooms.js';

export const RuntimeStateSchema = Type.Union([
  Type.Literal('STARTING'),
  Type.Literal('RUNNING'),
  Type.Literal('DEGRADED'),
  Type.Literal('STOPPED'),
]);

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
    binding: RuntimeStatusSchema,
    roster: RuntimeStatusSchema,
    tracking: Type.Object({
      ...RuntimeStatusSchema.properties,
      configured: Type.Boolean(),
    }),
  }),
  shipmentCounts: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
  snapshotRunCounts: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
  status: Type.Union([Type.Literal('ok'), Type.Literal('needs_setup'), Type.Literal('degraded')]),
  trackingDueCount: Type.Integer({ minimum: 0 }),
  version: Type.String(),
});
export type SystemStatus = Static<typeof SystemStatusSchema>;
