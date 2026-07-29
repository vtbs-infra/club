import { sql } from 'drizzle-orm';
import {
  boolean,
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
    active: boolean('active').default(true).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('creators_user_unique').on(table.userId),
    uniqueIndex('creators_bilibili_uid_unique').on(table.bilibiliUid),
    uniqueIndex('creators_room_id_unique').on(table.roomId),
    index('creators_active_idx').on(table.active),
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
    healthStatus: text('health_status').default('UNKNOWN').notNull(),
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

export const bindingChallenges = pgTable(
  'binding_challenges',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    verificationRoomId: uuid('verification_room_id')
      .notNull()
      .references(() => verificationRooms.id, { onDelete: 'restrict' }),
    codeDigest: text('code_digest').notNull(),
    status: text('status').default('ACTIVE').notNull(),
    expiresAt: timestamp('expires_at', { mode: 'date', withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { mode: 'date', withTimezone: true }),
    consumedEventId: text('consumed_event_id'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('binding_challenges_active_user_unique')
      .on(table.userId)
      .where(sql`${table.status} = 'ACTIVE'`),
    uniqueIndex('binding_challenges_consumed_event_unique')
      .on(table.consumedEventId)
      .where(sql`${table.consumedEventId} is not null`),
    index('binding_challenges_match_idx').on(
      table.verificationRoomId,
      table.codeDigest,
      table.status,
    ),
    index('binding_challenges_expiry_idx').on(table.status, table.expiresAt),
    check(
      'binding_challenges_status_check',
      sql`${table.status} in ('ACTIVE', 'CONSUMED', 'EXPIRED', 'CANCELLED', 'CONFLICT')`,
    ),
  ],
);

export const bilibiliBindings = pgTable(
  'bilibili_bindings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    challengeId: uuid('challenge_id')
      .notNull()
      .references(() => bindingChallenges.id, { onDelete: 'restrict' }),
    biliUid: text('bili_uid').notNull(),
    biliDisplayName: text('bili_display_name'),
    boundAt: timestamp('bound_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    unboundAt: timestamp('unbound_at', { mode: 'date', withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('bilibili_bindings_challenge_unique').on(table.challengeId),
    uniqueIndex('bilibili_bindings_active_user_unique')
      .on(table.userId)
      .where(sql`${table.unboundAt} is null`),
    uniqueIndex('bilibili_bindings_active_uid_unique')
      .on(table.biliUid)
      .where(sql`${table.unboundAt} is null`),
    index('bilibili_bindings_user_history_idx').on(table.userId, table.boundAt),
  ],
);
