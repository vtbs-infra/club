import { sql } from 'drizzle-orm';
import {
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
import type {
  BilibiliAccount,
  BilibiliLoginState,
  BilibiliReachability,
  BilibiliSessionOperation,
  BilibiliSessionValidity,
} from '../../../../shared/contracts/bilibili.js';
import type { EncryptedValue } from '../../encryption/key-ring.js';
import { sessions, users } from './auth.js';
import { timestamps } from './shared.js';

export const bilibiliSessions = pgTable(
  'bilibili_sessions',
  {
    id: text('id').primaryKey().default('global'),
    revision: integer('revision').notNull().default(0),
    validity: text('validity').$type<BilibiliSessionValidity>().notNull().default('NOT_CONFIGURED'),
    reachability: text('reachability').$type<BilibiliReachability>().notNull().default('UNKNOWN'),
    account: jsonb('account').$type<BilibiliAccount>(),
    credentials: jsonb('credentials').$type<EncryptedValue>(),
    pendingCredentials: jsonb('pending_credentials').$type<EncryptedValue>(),
    operation: text('operation').$type<BilibiliSessionOperation>(),
    operationId: uuid('operation_id'),
    operationExpiresAt: timestamp('operation_expires_at', { mode: 'date', withTimezone: true }),
    errorCode: text('error_code'),
    loggedInAt: timestamp('logged_in_at', { mode: 'date', withTimezone: true }),
    checkedAt: timestamp('checked_at', { mode: 'date', withTimezone: true }),
    refreshedAt: timestamp('refreshed_at', { mode: 'date', withTimezone: true }),
    nextCheckAt: timestamp('next_check_at', { mode: 'date', withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check('bilibili_sessions_singleton_check', sql`${table.id} = 'global'`),
    check('bilibili_sessions_revision_check', sql`${table.revision} >= 0`),
    check(
      'bilibili_sessions_validity_check',
      sql`${table.validity} in ('NOT_CONFIGURED', 'CHECKING', 'VALID', 'REAUTH_REQUIRED')`,
    ),
    check(
      'bilibili_sessions_reachability_check',
      sql`${table.reachability} in ('UNKNOWN', 'HEALTHY', 'UNAVAILABLE')`,
    ),
    check(
      'bilibili_sessions_operation_check',
      sql`(${table.operation} is null and ${table.operationId} is null and ${table.operationExpiresAt} is null) or (${table.operation} is not null and ${table.operation} in ('CHECKING', 'REFRESHING', 'VERIFYING') and ${table.operationId} is not null and ${table.operationExpiresAt} is not null)`,
    ),
    check(
      'bilibili_sessions_valid_credentials_check',
      sql`${table.validity} <> 'VALID' or (${table.credentials} is not null and ${table.account} is not null)`,
    ),
  ],
);

export const bilibiliLoginAttempts = pgTable(
  'bilibili_login_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    clubSessionId: text('club_session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    state: text('state').$type<BilibiliLoginState>().notNull().default('CREATING'),
    baseRevision: integer('base_revision').notNull(),
    qrContext: jsonb('qr_context').$type<EncryptedValue>(),
    candidateCredentials: jsonb('candidate_credentials').$type<EncryptedValue>(),
    account: jsonb('account').$type<BilibiliAccount>(),
    expiresAt: timestamp('expires_at', { mode: 'date', withTimezone: true }).notNull(),
    nextPollAt: timestamp('next_poll_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow(),
    operationId: uuid('operation_id'),
    operationExpiresAt: timestamp('operation_expires_at', { mode: 'date', withTimezone: true }),
    errorCode: text('error_code'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('bilibili_login_attempts_active_admin_unique')
      .on(table.adminUserId)
      .where(sql`${table.state} in ('CREATING', 'WAITING', 'VERIFYING', 'READY', 'ACTIVATING')`),
    index('bilibili_login_attempts_expiry_idx').on(table.expiresAt),
    check(
      'bilibili_login_attempts_state_check',
      sql`${table.state} in ('CREATING', 'WAITING', 'VERIFYING', 'READY', 'ACTIVATING', 'APPLIED', 'CANCELLED', 'EXPIRED', 'FAILED')`,
    ),
    check(
      'bilibili_login_attempts_terminal_secrets_check',
      sql`${table.state} in ('CREATING', 'WAITING', 'VERIFYING', 'READY', 'ACTIVATING') or (${table.qrContext} is null and ${table.candidateCredentials} is null)`,
    ),
  ],
);
