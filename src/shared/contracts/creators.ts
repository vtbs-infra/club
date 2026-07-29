import { Type, type Static } from '@sinclair/typebox';

import { AccountRoleSchema, DateTimeSchema, IdSchema, Nullable } from './common.js';

export const CreatorProfileSchema = Type.Object({
  active: Type.Boolean(),
  bilibiliUid: Type.String(),
  displayName: Type.String(),
  id: IdSchema,
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
  email: Type.String({ format: 'email' }),
  id: IdSchema,
  name: Type.String(),
  role: AccountRoleSchema,
});
export type UserRecord = Static<typeof UserRecordSchema>;

export const CreatorRecordSchema = Type.Object({
  active: Type.Boolean(),
  bilibiliUid: Type.String(),
  createdAt: DateTimeSchema,
  displayName: Type.String(),
  email: Type.String({ format: 'email' }),
  id: IdSchema,
  roomId: Type.String(),
  timezone: Type.String(),
  userId: IdSchema,
  userName: Type.String(),
});
export type CreatorRecord = Static<typeof CreatorRecordSchema>;

export const CreatorInputSchema = Type.Object(
  {
    bilibiliUid: Type.String({ maxLength: 32, minLength: 1, pattern: '^[0-9]+$' }),
    displayName: Type.String({ maxLength: 120, minLength: 1 }),
    roomId: Type.String({ maxLength: 32, minLength: 1, pattern: '^[0-9]+$' }),
    timezone: Type.String({ maxLength: 100, minLength: 1 }),
    userId: IdSchema,
  },
  { additionalProperties: false },
);

export const CreatorUpdateSchema = Type.Object(
  {
    active: Type.Optional(Type.Boolean()),
    bilibiliUid: Type.Optional(Type.String({ maxLength: 32, minLength: 1, pattern: '^[0-9]+$' })),
    displayName: Type.Optional(Type.String({ maxLength: 120, minLength: 1 })),
    roomId: Type.Optional(Type.String({ maxLength: 32, minLength: 1, pattern: '^[0-9]+$' })),
    timezone: Type.Optional(Type.String({ maxLength: 100, minLength: 1 })),
  },
  { additionalProperties: false, minProperties: 1 },
);

export const CreatorOverviewSchema = Type.Object({
  activeCreators: Type.Integer({ minimum: 0 }),
  creators: Type.Integer({ minimum: 0 }),
  recent: Type.Array(
    Type.Object({
      active: Type.Boolean(),
      displayName: Type.String(),
      id: IdSchema,
      updatedAt: DateTimeSchema,
    }),
  ),
});
export type CreatorOverview = Static<typeof CreatorOverviewSchema>;
