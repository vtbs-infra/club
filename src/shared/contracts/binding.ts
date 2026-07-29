import { Type, type Static } from '@sinclair/typebox';

import { DateTimeSchema, IdSchema, Nullable } from './common.js';

export const BilibiliBindingSchema = Type.Object({
  biliDisplayName: Nullable(Type.String()),
  biliUid: Type.String(),
  boundAt: DateTimeSchema,
  id: IdSchema,
});
export type BilibiliBinding = Static<typeof BilibiliBindingSchema>;

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
