import type { AccountRole } from '../../../../shared/contracts/common.js';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamps } from './shared.js';

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    username: text('username').notNull(),
    name: text('name').notNull(),
    role: text('role').$type<AccountRole>().default('USER').notNull(),
    bilibiliUid: text('bilibili_uid'),
    authVersion: integer('auth_version').default(1).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('users_username_unique').on(table.username),
    uniqueIndex('users_bilibili_uid_unique').on(table.bilibiliUid),
    unique('users_id_uid_unique').on(table.id, table.bilibiliUid),
    check('users_username_check', sql`${table.username} ~ '^[a-z0-9_]{3,30}$'`),
    check('users_role_check', sql`${table.role} in ('USER', 'CREATOR', 'PLATFORM_ADMIN')`),
    check(
      'users_uid_check',
      sql`(${table.bilibiliUid} is not null and ${table.bilibiliUid} ~ '^[1-9][0-9]{0,19}$') or (${table.role} = 'PLATFORM_ADMIN' and ${table.bilibiliUid} is null)`,
    ),
    check('users_auth_version_check', sql`${table.authVersion} > 0`),
  ],
);

export const passwordCredentials = pgTable('password_credentials', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  passwordHash: text('password_hash').notNull(),
  ...timestamps,
});

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    authVersion: integer('auth_version').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    expiresAt: timestamp('expires_at', { mode: 'date', withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_expires_at_idx').on(table.expiresAt),
  ],
);
