import { Type, type Static } from '@sinclair/typebox';

import { AccountRoleSchema, DateTimeSchema, IdSchema, Nullable } from './common.js';

export const BilibiliBindingSchema = Type.Object({
  biliDisplayName: Nullable(Type.String()),
  biliUid: Type.String(),
  boundAt: DateTimeSchema,
  id: IdSchema,
});
export type BilibiliBinding = Static<typeof BilibiliBindingSchema>;

export const AdminBilibiliBindingSchema = Type.Object({
  biliDisplayName: Nullable(Type.String()),
  biliUid: Type.String(),
  boundAt: DateTimeSchema,
  id: IdSchema,
  user: Type.Object({
    email: Type.String({ format: 'email' }),
    id: IdSchema,
    name: Type.String(),
    role: AccountRoleSchema,
  }),
});
export type AdminBilibiliBinding = Static<typeof AdminBilibiliBindingSchema>;

export const AdminBilibiliBindingPageSchema = Type.Object({
  items: Type.Array(AdminBilibiliBindingSchema),
  nextCursor: Nullable(Type.String()),
});
export type AdminBilibiliBindingPage = Static<typeof AdminBilibiliBindingPageSchema>;

export const BindingConflictStatusSchema = Type.Union([
  Type.Literal('OPEN'),
  Type.Literal('RESOLVED'),
  Type.Literal('DISMISSED'),
]);

export const BilibiliChallengeStatusSchema = Type.Union([
  Type.Literal('ACTIVE'),
  Type.Literal('CONSUMED'),
  Type.Literal('EXPIRED'),
  Type.Literal('CANCELLED'),
  Type.Literal('CONFLICT'),
]);

export const RoomConnectionStateSchema = Type.Union([
  Type.Literal('CONNECTING'),
  Type.Literal('HEALTHY'),
  Type.Literal('UNHEALTHY'),
]);

export const BilibiliChallengeSchema = Type.Object({
  conflictStatus: Nullable(BindingConflictStatusSchema),
  connectionState: Nullable(RoomConnectionStateSchema),
  expiresAt: DateTimeSchema,
  id: IdSchema,
  room: Type.Object({
    displayName: Type.String(),
    link: Type.String({ format: 'uri' }),
  }),
  status: BilibiliChallengeStatusSchema,
});
export type BilibiliChallenge = Static<typeof BilibiliChallengeSchema>;

export const IssuedBilibiliChallengeSchema = Type.Object({
  code: Type.String({ pattern: '^CLUB-[A-HJ-NP-Z2-9]{6}$' }),
  expiresAt: DateTimeSchema,
  id: IdSchema,
  room: Type.Object({
    displayName: Type.String(),
    id: IdSchema,
    link: Type.String({ format: 'uri' }),
  }),
});
export type IssuedBilibiliChallenge = Static<typeof IssuedBilibiliChallengeSchema>;

const ConflictUserSchema = Type.Object({
  email: Type.String({ format: 'email' }),
  id: IdSchema,
  name: Type.String(),
});

export const BindingConflictSchema = Type.Object({
  biliUid: Type.String(),
  challengeId: IdSchema,
  createdAt: DateTimeSchema,
  id: IdSchema,
  observedBinding: Type.Object({
    biliDisplayName: Nullable(Type.String()),
    biliUid: Type.String(),
    boundAt: DateTimeSchema,
    id: IdSchema,
    unboundAt: Nullable(DateTimeSchema),
    user: ConflictUserSchema,
  }),
  requestingUser: ConflictUserSchema,
  status: BindingConflictStatusSchema,
});
export type BindingConflict = Static<typeof BindingConflictSchema>;

export const BindingConflictPageSchema = Type.Object({
  items: Type.Array(BindingConflictSchema),
  nextCursor: Nullable(Type.String()),
});
export type BindingConflictPage = Static<typeof BindingConflictPageSchema>;

export const BindingConflictResolutionInputSchema = Type.Object(
  { reason: Type.String({ maxLength: 500, minLength: 3 }) },
  { additionalProperties: false },
);
export type BindingConflictResolutionInput = Static<typeof BindingConflictResolutionInputSchema>;
