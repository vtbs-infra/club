import { Type, type Static } from '@sinclair/typebox';

import { DateTimeSchema, IdSchema, Nullable } from './common.js';

export const VerificationRoomHealthSchema = Type.Union([
  Type.Literal('UNKNOWN'),
  Type.Literal('CONNECTING'),
  Type.Literal('HEALTHY'),
  Type.Literal('UNHEALTHY'),
]);

export const VerificationRoomSchema = Type.Object({
  biliRoomId: Type.String(),
  displayName: Type.String(),
  enabled: Type.Boolean(),
  healthStatus: VerificationRoomHealthSchema,
  id: IdSchema,
  lastConnectedAt: Nullable(DateTimeSchema),
  priority: Type.Integer(),
});
export type VerificationRoom = Static<typeof VerificationRoomSchema>;

export const VerificationRoomInputSchema = Type.Object(
  {
    biliRoomId: Type.String({ maxLength: 32, minLength: 1, pattern: '^[0-9]+$' }),
    displayName: Type.String({ maxLength: 120, minLength: 1 }),
    enabled: Type.Optional(Type.Boolean({ default: true })),
    priority: Type.Optional(Type.Integer({ default: 100, maximum: 10_000, minimum: 0 })),
  },
  { additionalProperties: false },
);
export type VerificationRoomInput = Static<typeof VerificationRoomInputSchema>;

export const VerificationRoomUpdateSchema = Type.Object(
  {
    displayName: Type.Optional(Type.String({ maxLength: 120, minLength: 1 })),
    enabled: Type.Optional(Type.Boolean()),
    priority: Type.Optional(Type.Integer({ maximum: 10_000, minimum: 0 })),
  },
  { additionalProperties: false, minProperties: 1 },
);
export type VerificationRoomUpdate = Static<typeof VerificationRoomUpdateSchema>;
