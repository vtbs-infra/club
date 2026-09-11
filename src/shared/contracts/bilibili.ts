import { Type, type Static } from '@sinclair/typebox';
import { DateTimeSchema, IdSchema, Nullable } from './common.js';

export const BilibiliAccountSchema = Type.Object({
  uid: Type.String(),
  name: Type.String(),
  avatar: Type.String(),
});
export type BilibiliAccount = Static<typeof BilibiliAccountSchema>;

export const BilibiliSessionValiditySchema = Type.Union([
  Type.Literal('NOT_CONFIGURED'),
  Type.Literal('CHECKING'),
  Type.Literal('VALID'),
  Type.Literal('REAUTH_REQUIRED'),
]);
export type BilibiliSessionValidity = Static<typeof BilibiliSessionValiditySchema>;
export const BilibiliReachabilitySchema = Type.Union([
  Type.Literal('UNKNOWN'),
  Type.Literal('HEALTHY'),
  Type.Literal('UNAVAILABLE'),
]);
export type BilibiliReachability = Static<typeof BilibiliReachabilitySchema>;
export const BilibiliSessionOperationSchema = Type.Union([
  Type.Literal('CHECKING'),
  Type.Literal('REFRESHING'),
  Type.Literal('VERIFYING'),
]);
export type BilibiliSessionOperation = Static<typeof BilibiliSessionOperationSchema>;
export const BilibiliLoginStateSchema = Type.Union([
  Type.Literal('CREATING'),
  Type.Literal('WAITING'),
  Type.Literal('VERIFYING'),
  Type.Literal('READY'),
  Type.Literal('ACTIVATING'),
  Type.Literal('APPLIED'),
  Type.Literal('CANCELLED'),
  Type.Literal('EXPIRED'),
  Type.Literal('FAILED'),
]);
export type BilibiliLoginState = Static<typeof BilibiliLoginStateSchema>;
export const BilibiliLoginAttemptSchema = Type.Object({
  id: IdSchema,
  state: BilibiliLoginStateSchema,
  expiresAt: DateTimeSchema,
  qrUrl: Nullable(Type.String()),
  account: Nullable(BilibiliAccountSchema),
  errorCode: Nullable(Type.String()),
  baseRevision: Type.Integer(),
});
export type BilibiliLoginAttempt = Static<typeof BilibiliLoginAttemptSchema>;
export const BilibiliSessionStatusSchema = Type.Object({
  revision: Type.Integer(),
  validity: BilibiliSessionValiditySchema,
  reachability: BilibiliReachabilitySchema,
  account: Nullable(BilibiliAccountSchema),
  operation: Nullable(BilibiliSessionOperationSchema),
  errorCode: Nullable(Type.String()),
  loggedInAt: Nullable(DateTimeSchema),
  checkedAt: Nullable(DateTimeSchema),
  refreshedAt: Nullable(DateTimeSchema),
  nextCheckAt: Nullable(DateTimeSchema),
  loginAttempt: Nullable(BilibiliLoginAttemptSchema),
});
export type BilibiliSessionStatus = Static<typeof BilibiliSessionStatusSchema>;
export const BilibiliRevisionInputSchema = Type.Object(
  {
    revision: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
