import { Type, type Static } from '@sinclair/typebox';
import { AccountRoleSchema, DateTimeSchema, IdSchema, Nullable } from './common.js';

export const UsernameSchema = Type.String({
  minLength: 3,
  maxLength: 30,
  pattern: '^[A-Za-z0-9_]+$',
});
export const PasswordSchema = Type.String({ minLength: 12, maxLength: 128 });
export const DisplayNameSchema = Type.String({ minLength: 1, maxLength: 80, pattern: '\\S' });
export const BiliUidSchema = Type.String({ pattern: '^[1-9][0-9]{0,19}$' });
export const ChallengePurposeSchema = Type.Union([
  Type.Literal('REGISTER'),
  Type.Literal('RECOVER'),
]);
export const ChallengeStatusSchema = Type.Union(
  ['PENDING', 'VERIFIED', 'CONSUMED', 'EXPIRED', 'CANCELLED'].map((value) => Type.Literal(value)),
);
export type ChallengePurpose = Static<typeof ChallengePurposeSchema>;
export type ChallengeStatus = 'PENDING' | 'VERIFIED' | 'CONSUMED' | 'EXPIRED' | 'CANCELLED';

export const AuthUserSchema = Type.Object(
  {
    id: IdSchema,
    username: UsernameSchema,
    name: DisplayNameSchema,
    role: AccountRoleSchema,
    bilibiliUid: Nullable(BiliUidSchema),
  },
  { additionalProperties: false },
);
export const AuthSessionSchema = Type.Object(
  {
    user: AuthUserSchema,
    session: Type.Object({ expiresAt: DateTimeSchema }, { additionalProperties: false }),
  },
  { additionalProperties: false },
);
export type AuthUser = Static<typeof AuthUserSchema>;
export type SessionState = Static<typeof AuthSessionSchema>;

export const CreateChallengeBodySchema = Type.Union([
  Type.Object({ purpose: Type.Literal('REGISTER') }, { additionalProperties: false }),
  Type.Object(
    { purpose: Type.Literal('RECOVER'), biliUid: BiliUidSchema },
    { additionalProperties: false },
  ),
]);
export type CreateChallengeBody = Static<typeof CreateChallengeBodySchema>;
export const RoomConnectionStateSchema = Type.Union([
  Type.Literal('CONNECTING'),
  Type.Literal('HEALTHY'),
  Type.Literal('UNHEALTHY'),
]);
export type RoomConnectionState = Static<typeof RoomConnectionStateSchema>;
export const ChallengeSchema = Type.Object(
  {
    id: IdSchema,
    purpose: ChallengePurposeSchema,
    status: ChallengeStatusSchema,
    expiresAt: DateTimeSchema,
    code: Type.Optional(Type.String()),
    room: Type.Object({ displayName: Type.String(), link: Type.String() }),
    connectionState: Nullable(RoomConnectionStateSchema),
    biliUid: Nullable(BiliUidSchema),
    username: Nullable(UsernameSchema),
  },
  { additionalProperties: false },
);
export type IdentityChallenge = Static<typeof ChallengeSchema>;
export const RegisterBodySchema = Type.Object(
  {
    challengeId: IdSchema,
    username: UsernameSchema,
    name: DisplayNameSchema,
    password: PasswordSchema,
  },
  { additionalProperties: false },
);
export const LoginBodySchema = Type.Object(
  { username: UsernameSchema, password: Type.String({ minLength: 1, maxLength: 128 }) },
  { additionalProperties: false },
);
export const RecoverBodySchema = Type.Object(
  { challengeId: IdSchema, password: PasswordSchema },
  { additionalProperties: false },
);
export const ChangePasswordBodySchema = Type.Object(
  { currentPassword: Type.String({ minLength: 1, maxLength: 128 }), password: PasswordSchema },
  { additionalProperties: false },
);
export const UpdateProfileBodySchema = Type.Object(
  { name: DisplayNameSchema },
  { additionalProperties: false },
);
