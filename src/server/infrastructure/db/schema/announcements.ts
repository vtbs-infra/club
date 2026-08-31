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
    publicVisible: boolean('public_visible').default(false).notNull(),
    status: text('status').default('DRAFT').notNull(),
    publishedAt: timestamp('published_at', { mode: 'date', withTimezone: true }),
    withdrawnAt: timestamp('withdrawn_at', { mode: 'date', withTimezone: true }),
    expiresAt: timestamp('expires_at', { mode: 'date', withTimezone: true }),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    version: integer('version').default(1).notNull(),
    ...timestamps,
  },
  (table) => [
    index('announcements_visibility_idx').on(
      table.scope,
      table.status,
      table.publishedAt,
      table.expiresAt,
    ),
    index('announcements_scope_status_created_idx').on(
      table.scope,
      table.status,
      table.createdAt,
      table.id,
    ),
    index('announcements_creator_created_idx').on(table.creatorId, table.createdAt, table.id),
    check('announcements_scope_check', sql`${table.scope} in ('PLATFORM', 'CREATOR')`),
    check(
      'announcements_severity_check',
      sql`${table.severity} in ('INFO', 'WARNING', 'CRITICAL')`,
    ),
    check('announcements_version_positive', sql`${table.version} > 0`),
    check(
      'announcements_expiry_check',
      sql`${table.status} = 'DRAFT' or ${table.expiresAt} is null or ${table.expiresAt} > ${table.publishedAt}`,
    ),
    check(
      'announcements_lifecycle_check',
      sql`(
        (${table.status} = 'DRAFT' and ${table.publishedAt} is null and ${table.withdrawnAt} is null)
        or (${table.status} = 'PUBLISHED' and ${table.publishedAt} is not null and ${table.withdrawnAt} is null)
        or (${table.status} = 'WITHDRAWN' and ${table.publishedAt} is not null and ${table.withdrawnAt} is not null and ${table.withdrawnAt} >= ${table.publishedAt})
      )`,
    ),
    check(
      'announcements_public_scope_check',
      sql`not ${table.publicVisible} or ${table.scope} = 'PLATFORM'`,
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
    announcementVersion: integer('announcement_version').notNull(),
    readAt: timestamp('read_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('announcement_reads_announcement_user_version_unique').on(
      table.announcementId,
      table.userId,
      table.announcementVersion,
    ),
    index('announcement_reads_user_read_idx').on(table.userId, table.readAt),
    check('announcement_reads_version_positive', sql`${table.announcementVersion} > 0`),
  ],
);
