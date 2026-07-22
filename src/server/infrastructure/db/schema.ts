import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
};

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').default(false).notNull(),
    image: text('image'),
    platformRole: text('platform_role').default('USER').notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('users_email_unique').on(table.email),
    check('users_platform_role_check', sql`${table.platformRole} in ('USER', 'PLATFORM_ADMIN')`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    expiresAt: timestamp('expires_at', { mode: 'date', withTimezone: true }).notNull(),
    token: text('token').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('sessions_token_unique').on(table.token),
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_expires_at_idx').on(table.expiresAt),
  ],
);

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', {
      mode: 'date',
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
      mode: 'date',
      withTimezone: true,
    }),
    scope: text('scope'),
    password: text('password'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('accounts_provider_account_unique').on(table.providerId, table.accountId),
    index('accounts_user_id_idx').on(table.userId),
  ],
);

export const verifications = pgTable(
  'verifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { mode: 'date', withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [index('verifications_identifier_idx').on(table.identifier)],
);

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    archivedAt: timestamp('archived_at', { mode: 'date', withTimezone: true }),
    ...timestamps,
  },
  (table) => [uniqueIndex('organizations_slug_unique').on(table.slug)],
);

export const organizationMembers = pgTable(
  'organization_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('organization_members_org_user_unique').on(table.organizationId, table.userId),
    index('organization_members_user_id_idx').on(table.userId),
    check(
      'organization_members_role_check',
      sql`${table.role} in ('OWNER', 'ADMIN', 'OPERATOR', 'FULFILLMENT', 'VIEWER')`,
    ),
  ],
);

export const creators = pgTable(
  'creators',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    bilibiliUid: text('bilibili_uid').notNull(),
    roomId: text('room_id').notNull(),
    displayName: text('display_name').notNull(),
    timezone: text('timezone').notNull(),
    active: boolean('active').default(true).notNull(),
    archivedAt: timestamp('archived_at', { mode: 'date', withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('creators_org_bilibili_uid_unique').on(table.organizationId, table.bilibiliUid),
    index('creators_organization_id_idx').on(table.organizationId),
  ],
);

export const memberCreatorScopes = pgTable(
  'member_creator_scopes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => organizationMembers.id, { onDelete: 'cascade' }),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('member_creator_scopes_member_creator_unique').on(table.memberId, table.creatorId),
    index('member_creator_scopes_creator_id_idx').on(table.creatorId),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    creatorId: uuid('creator_id').references(() => creators.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    beforeSummary: jsonb('before_summary').$type<Record<string, unknown> | null>(),
    afterSummary: jsonb('after_summary').$type<Record<string, unknown> | null>(),
    requestId: text('request_id'),
    ipAddress: text('ip_address'),
    reason: text('reason'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('audit_logs_organization_created_idx').on(table.organizationId, table.createdAt),
    index('audit_logs_actor_created_idx').on(table.actorUserId, table.createdAt),
  ],
);

export const schema = {
  accounts,
  auditLogs,
  creators,
  memberCreatorScopes,
  organizationMembers,
  organizations,
  sessions,
  users,
  verifications,
};

export type AppSchema = typeof schema;
