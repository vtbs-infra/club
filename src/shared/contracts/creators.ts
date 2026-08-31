import { Type, type Static } from '@sinclair/typebox';

import { AccountRoleSchema, DateTimeSchema, IdSchema, Nullable } from './common.js';

export const CreatorProfileSchema = Type.Object({
  bilibiliUid: Type.String(),
  displayName: Type.String(),
  id: IdSchema,
  monthlySyncEnabled: Type.Boolean(),
  profileSyncedAt: DateTimeSchema,
  roomId: Type.String(),
  timezone: Type.String(),
});

export const IdentitySchema = Type.Object({
  creator: Nullable(CreatorProfileSchema),
  user: Type.Object({
    email: Type.String({ format: 'email' }),
    id: IdSchema,
    image: Nullable(Type.String()),
    name: Type.String(),
    role: AccountRoleSchema,
  }),
});
export type Identity = Static<typeof IdentitySchema>;

export const UserRecordSchema = Type.Object({
  bilibiliBinding: Nullable(
    Type.Object({
      biliDisplayName: Nullable(Type.String()),
      biliUid: Type.String(),
      id: IdSchema,
    }),
  ),
  email: Type.String({ format: 'email' }),
  id: IdSchema,
  name: Type.String(),
  role: AccountRoleSchema,
});
export type UserRecord = Static<typeof UserRecordSchema>;

export const CreatorRecordSchema = Type.Object({
  bilibiliUid: Type.String(),
  createdAt: DateTimeSchema,
  displayName: Type.String(),
  email: Type.String({ format: 'email' }),
  id: IdSchema,
  monthlySyncEnabled: Type.Boolean(),
  profileSyncedAt: DateTimeSchema,
  roomId: Type.String(),
  timezone: Type.String(),
  userId: IdSchema,
  userName: Type.String(),
});
export type CreatorRecord = Static<typeof CreatorRecordSchema>;

export const CreatorRecordPageSchema = Type.Object({
  items: Type.Array(CreatorRecordSchema),
  nextCursor: Nullable(Type.String()),
});
export type CreatorRecordPage = Static<typeof CreatorRecordPageSchema>;

export const CreatorInputSchema = Type.Object(
  {
    monthlySyncEnabled: Type.Optional(Type.Boolean()),
    timezone: Type.String({ maxLength: 100, minLength: 1 }),
    userId: IdSchema,
  },
  { additionalProperties: false },
);

export const CreatorSettingsSchema = Type.Object(
  {
    monthlySyncEnabled: Type.Optional(Type.Boolean()),
    timezone: Type.Optional(Type.String({ maxLength: 100, minLength: 1 })),
  },
  { additionalProperties: false, minProperties: 1 },
);

export const CreatorOverviewSchema = Type.Object({
  creators: Type.Integer({ minimum: 0 }),
  monthlySyncCreators: Type.Integer({ minimum: 0 }),
  rosterAttention: Type.Object({
    failed: Type.Integer({ minimum: 0 }),
    pendingApproval: Type.Integer({ minimum: 0 }),
  }),
  recent: Type.Array(
    Type.Object({
      displayName: Type.String(),
      id: IdSchema,
      monthlySyncEnabled: Type.Boolean(),
      updatedAt: DateTimeSchema,
    }),
  ),
});
export type CreatorOverview = Static<typeof CreatorOverviewSchema>;
