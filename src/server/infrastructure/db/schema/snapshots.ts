import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  date,
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

export const snapshotRuns = pgTable(
  'snapshot_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id, { onDelete: 'restrict' }),
    creatorBilibiliUid: text('creator_bilibili_uid').notNull(),
    creatorRoomId: text('creator_room_id').notNull(),
    periodStart: date('period_start', { mode: 'string' }).notNull(),
    cutoffTimezone: text('cutoff_timezone').notNull(),
    scheduledCutoffAt: timestamp('scheduled_cutoff_at', {
      mode: 'date',
      withTimezone: true,
    }).notNull(),
    onTimeWindowEndAt: timestamp('on_time_window_end_at', {
      mode: 'date',
      withTimezone: true,
    }).notNull(),
    acceptedAttemptId: uuid('accepted_attempt_id').references(
      (): AnyPgColumn => snapshotAttempts.id,
      { onDelete: 'restrict' },
    ),
    status: text('status').default('SCHEDULED').notNull(),
    finalizedAt: timestamp('finalized_at', { mode: 'date', withTimezone: true }),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { mode: 'date', withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('snapshot_runs_creator_period_unique').on(table.creatorId, table.periodStart),
    index('snapshot_runs_due_idx').on(table.status, table.scheduledCutoffAt),
    index('snapshot_runs_creator_period_idx').on(table.creatorId, table.periodStart),
    index('snapshot_runs_period_id_idx').on(table.periodStart, table.id),
    check(
      'snapshot_runs_status_check',
      sql`${table.status} in ('SCHEDULED', 'RUNNING', 'FAILED', 'PENDING_APPROVAL', 'FINALIZED', 'REJECTED', 'CANCELLED')`,
    ),
  ],
);

export const snapshotAttempts = pgTable(
  'snapshot_attempts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    snapshotRunId: uuid('snapshot_run_id')
      .notNull()
      .references(() => snapshotRuns.id, { onDelete: 'restrict' }),
    attemptNumber: integer('attempt_number').notNull(),
    schedulerStartedAt: timestamp('scheduler_started_at', {
      mode: 'date',
      withTimezone: true,
    }).notNull(),
    captureStartedAt: timestamp('capture_started_at', { mode: 'date', withTimezone: true }),
    captureCompletedAt: timestamp('capture_completed_at', { mode: 'date', withTimezone: true }),
    punctuality: text('punctuality'),
    consistencyStatus: text('consistency_status').default('PENDING').notNull(),
    declaredTotal: integer('declared_total'),
    normalizedTotal: integer('normalized_total'),
    sourceName: text('source_name').notNull(),
    sourceVersion: text('source_version').notNull(),
    initiatedBy: text('initiated_by').default('SCHEDULER').notNull(),
    requestedByUserId: uuid('requested_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('snapshot_attempts_run_number_unique').on(table.snapshotRunId, table.attemptNumber),
    index('snapshot_attempts_run_created_idx').on(table.snapshotRunId, table.createdAt),
    check('snapshot_attempts_number_check', sql`${table.attemptNumber} between 1 and 3`),
    check(
      'snapshot_attempts_punctuality_check',
      sql`${table.punctuality} is null or ${table.punctuality} in ('ON_TIME', 'LATE')`,
    ),
    check(
      'snapshot_attempts_consistency_check',
      sql`${table.consistencyStatus} in ('PENDING', 'CONSISTENT', 'INCONSISTENT')`,
    ),
    check(
      'snapshot_attempts_initiated_by_check',
      sql`${table.initiatedBy} in ('SCHEDULER', 'ADMIN')`,
    ),
  ],
);

export const snapshotPages = pgTable(
  'snapshot_pages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    snapshotAttemptId: uuid('snapshot_attempt_id')
      .notNull()
      .references(() => snapshotAttempts.id, { onDelete: 'restrict' }),
    captureKind: text('capture_kind').notNull(),
    pageNumber: integer('page_number').notNull(),
    declaredPageCount: integer('declared_page_count').notNull(),
    declaredTotal: integer('declared_total').notNull(),
    objectKey: text('object_key').notNull(),
    contentHashSha256: text('content_hash_sha256').notNull(),
    contentEncoding: text('content_encoding').default('gzip').notNull(),
    compressedSize: integer('compressed_size').notNull(),
    uncompressedSize: integer('uncompressed_size').notNull(),
    itemCount: integer('item_count').notNull(),
    fetchedAt: timestamp('fetched_at', { mode: 'date', withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('snapshot_pages_attempt_kind_page_unique').on(
      table.snapshotAttemptId,
      table.captureKind,
      table.pageNumber,
    ),
    uniqueIndex('snapshot_pages_object_key_unique').on(table.objectKey),
    check('snapshot_pages_page_positive', sql`${table.pageNumber} > 0`),
    check('snapshot_pages_capture_kind_check', sql`${table.captureKind} in ('PAGE', 'RECHECK')`),
    check(
      'snapshot_pages_declared_counts_check',
      sql`${table.declaredPageCount} > 0 and ${table.declaredTotal} >= 0`,
    ),
    check('snapshot_pages_hash_check', sql`${table.contentHashSha256} ~ '^[0-9a-f]{64}$'`),
    check(
      'snapshot_pages_sizes_non_negative',
      sql`${table.compressedSize} >= 0 and ${table.uncompressedSize} >= 0 and ${table.itemCount} >= 0`,
    ),
  ],
);

export const snapshotAttemptMembers = pgTable(
  'snapshot_attempt_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    snapshotAttemptId: uuid('snapshot_attempt_id')
      .notNull()
      .references(() => snapshotAttempts.id, { onDelete: 'restrict' }),
    biliUid: text('bili_uid').notNull(),
    displayNameAtCapture: text('display_name_at_capture').notNull(),
    tier: text('tier').notNull(),
    rawTier: text('raw_tier').notNull(),
    sourcePage: integer('source_page').notNull(),
    sourcePosition: integer('source_position').notNull(),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('snapshot_attempt_members_attempt_uid_unique').on(
      table.snapshotAttemptId,
      table.biliUid,
    ),
    check(
      'snapshot_attempt_members_tier_check',
      sql`${table.tier} in ('CAPTAIN', 'ADMIRAL', 'GOVERNOR')`,
    ),
  ],
);

export const snapshotMembers = pgTable(
  'snapshot_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    snapshotRunId: uuid('snapshot_run_id')
      .notNull()
      .references(() => snapshotRuns.id, { onDelete: 'restrict' }),
    biliUid: text('bili_uid').notNull(),
    displayNameAtSnapshot: text('display_name_at_snapshot').notNull(),
    tier: text('tier').notNull(),
    rawTier: text('raw_tier').notNull(),
    sourcePosition: integer('source_position').notNull(),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('snapshot_members_run_uid_unique').on(table.snapshotRunId, table.biliUid),
    index('snapshot_members_run_position_uid_idx').on(
      table.snapshotRunId,
      table.sourcePosition,
      table.biliUid,
    ),
    index('snapshot_members_bili_uid_idx').on(table.biliUid),
    check('snapshot_members_tier_check', sql`${table.tier} in ('CAPTAIN', 'ADMIRAL', 'GOVERNOR')`),
  ],
);
