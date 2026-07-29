import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './auth.js';
import { creators } from './identity.js';
import { timestamps } from './shared.js';

export const announcements = pgTable(
  'announcements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    scope: text('scope').notNull(),
    creatorId: uuid('creator_id').references(() => creators.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    severity: text('severity').default('INFO').notNull(),
    pinned: boolean('pinned').default(false).notNull(),
    publishedAt: timestamp('published_at', { mode: 'date', withTimezone: true }),
    expiresAt: timestamp('expires_at', { mode: 'date', withTimezone: true }),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    version: integer('version').default(1).notNull(),
    ...timestamps,
  },
  (table) => [
    index('announcements_visibility_idx').on(table.scope, table.publishedAt, table.expiresAt),
    index('announcements_creator_created_idx').on(table.creatorId, table.createdAt),
    check('announcements_scope_check', sql`${table.scope} in ('PLATFORM', 'CREATOR')`),
    check(
      'announcements_severity_check',
      sql`${table.severity} in ('INFO', 'WARNING', 'CRITICAL')`,
    ),
    check('announcements_version_positive', sql`${table.version} > 0`),
    check(
      'announcements_expiry_check',
      sql`${table.expiresAt} is null or ${table.publishedAt} is null or ${table.expiresAt} > ${table.publishedAt}`,
    ),
    check(
      'announcements_scope_identity_check',
      sql`(
        (${table.scope} = 'PLATFORM' and ${table.creatorId} is null)
        or (${table.scope} = 'CREATOR' and ${table.creatorId} is not null)
      )`,
    ),
  ],
);

export const announcementReads = pgTable(
  'announcement_reads',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    announcementId: uuid('announcement_id')
      .notNull()
      .references(() => announcements.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    readAt: timestamp('read_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('announcement_reads_announcement_user_unique').on(
      table.announcementId,
      table.userId,
    ),
    index('announcement_reads_user_read_idx').on(table.userId, table.readAt),
  ],
);
