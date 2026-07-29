import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type { SitePageContent } from '../../../../shared/site-content.js';
import { users } from './auth.js';
import { timestamps } from './shared.js';

export const platformAppearance = pgTable(
  'platform_appearance',
  {
    id: text('id').primaryKey(),
    theme: text('theme').notNull(),
    version: integer('version').default(1).notNull(),
    updatedByUserId: uuid('updated_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps,
  },
  (table) => [
    check('platform_appearance_singleton_check', sql`${table.id} = 'global'`),
    check(
      'platform_appearance_theme_check',
      sql`${table.theme} in ('moe', 'neon', 'archive', 'pixel')`,
    ),
    check('platform_appearance_version_check', sql`${table.version} >= 1`),
  ],
);

export const sitePages = pgTable(
  'site_pages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slug: text('slug').notNull(),
    publishedVersionId: uuid('published_version_id').references(
      (): AnyPgColumn => sitePageVersions.id,
      { onDelete: 'set null' },
    ),
    draftVersionId: uuid('draft_version_id').references((): AnyPgColumn => sitePageVersions.id, {
      onDelete: 'set null',
    }),
    ...timestamps,
  },
  (table) => [uniqueIndex('site_pages_slug_unique').on(table.slug)],
);

export const sitePageVersions = pgTable(
  'site_page_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => sitePages.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    contentJson: jsonb('content_json').$type<SitePageContent>().notNull(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    publishedAt: timestamp('published_at', { mode: 'date', withTimezone: true }),
  },
  (table) => [
    uniqueIndex('site_page_versions_page_version_unique').on(table.pageId, table.version),
    index('site_page_versions_page_created_idx').on(table.pageId, table.createdAt),
    check('site_page_versions_version_positive', sql`${table.version} > 0`),
  ],
);

export const siteAssets = pgTable(
  'site_assets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    objectKey: text('object_key').notNull(),
    thumbnailObjectKey: text('thumbnail_object_key').notNull(),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('site_assets_object_key_unique').on(table.objectKey),
    uniqueIndex('site_assets_thumbnail_object_key_unique').on(table.thumbnailObjectKey),
    index('site_assets_created_idx').on(table.createdAt),
    check('site_assets_mime_type_check', sql`${table.mimeType} = 'image/webp'`),
    check(
      'site_assets_dimensions_positive',
      sql`${table.width} > 0 and ${table.height} > 0 and ${table.sizeBytes} > 0`,
    ),
    check('site_assets_sha256_check', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);
