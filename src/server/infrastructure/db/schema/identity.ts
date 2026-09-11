import type { VerificationRoom } from '../../../../shared/contracts/verification-rooms.js';
import type { ChallengePurpose, ChallengeStatus } from '../../../../shared/contracts/auth.js';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './auth.js';
import { timestamps } from './shared.js';

export const creators = pgTable(
  'creators',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    bilibiliUid: text('bilibili_uid').notNull(),
    roomId: text('room_id').notNull(),
    displayName: text('display_name').notNull(),
    timezone: text('timezone').default('Asia/Shanghai').notNull(),
    monthlySyncEnabled: boolean('monthly_sync_enabled').default(true).notNull(),
    profileSyncedAt: timestamp('profile_synced_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('creators_user_unique').on(table.userId),
    foreignKey({
      columns: [table.userId, table.bilibiliUid],
      foreignColumns: [users.id, users.bilibiliUid],
      name: 'creators_user_uid_fk',
    }).onDelete('restrict'),
    uniqueIndex('creators_bilibili_uid_unique').on(table.bilibiliUid),
    uniqueIndex('creators_room_id_unique').on(table.roomId),
    index('creators_monthly_sync_enabled_idx').on(table.monthlySyncEnabled),
    index('creators_created_id_idx').on(table.createdAt, table.id),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
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
    index('audit_logs_created_id_idx').on(table.createdAt, table.id),
    index('audit_logs_creator_created_idx').on(table.creatorId, table.createdAt),
    index('audit_logs_actor_created_idx').on(table.actorUserId, table.createdAt),
  ],
);

export const verificationRooms = pgTable(
  'verification_rooms',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    biliRoomId: text('bili_room_id').notNull(),
    displayName: text('display_name').notNull(),
    priority: integer('priority').default(100).notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    healthStatus: text('health_status')
      .$type<VerificationRoom['healthStatus']>()
      .default('UNKNOWN')
      .notNull(),
    lastConnectedAt: timestamp('last_connected_at', { mode: 'date', withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('verification_rooms_bili_room_id_unique').on(table.biliRoomId),
    index('verification_rooms_selection_idx').on(table.enabled, table.priority),
    check(
      'verification_rooms_health_status_check',
      sql`${table.healthStatus} in ('UNKNOWN', 'CONNECTING', 'HEALTHY', 'UNHEALTHY')`,
    ),
  ],
);

export const identityChallenges = pgTable(
  'identity_challenges',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerDigest: text('owner_digest').notNull(),
    purpose: text('purpose').$type<ChallengePurpose>().notNull(),
    verificationRoomId: uuid('verification_room_id')
      .notNull()
      .references(() => verificationRooms.id, { onDelete: 'restrict' }),
    codeDigest: text('code_digest').notNull(),
    status: text('status').$type<ChallengeStatus>().default('PENDING').notNull(),
    expectedUid: text('expected_uid'),
    expectedUserId: uuid('expected_user_id').references(() => users.id, { onDelete: 'cascade' }),
    expectedAuthVersion: integer('expected_auth_version'),
    verifiedUid: text('verified_uid'),
    verifiedAt: timestamp('verified_at', { mode: 'date', withTimezone: true }),
    eventId: text('event_id'),
    expiresAt: timestamp('expires_at', { mode: 'date', withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('identity_challenges_code_unique').on(table.codeDigest),
    uniqueIndex('identity_challenges_event_unique').on(table.eventId),
    index('identity_challenges_owner_idx').on(table.ownerDigest),
    index('identity_challenges_expiry_idx').on(table.expiresAt),
    check('identity_challenges_purpose_check', sql`${table.purpose} in ('REGISTER', 'RECOVER')`),
    check(
      'identity_challenges_status_check',
      sql`${table.status} in ('PENDING', 'VERIFIED', 'CONSUMED', 'EXPIRED', 'CANCELLED')`,
    ),
    check(
      'identity_challenges_proof_check',
      sql`${table.status} not in ('VERIFIED', 'CONSUMED') or (${table.verifiedUid} is not null and ${table.verifiedAt} is not null and ${table.eventId} is not null)`,
    ),
  ],
);
