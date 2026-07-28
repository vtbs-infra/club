import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export type AccountRole = 'USER' | 'CREATOR' | 'PLATFORM_ADMIN';
export type GuardTier = 'CAPTAIN' | 'ADMIRAL' | 'GOVERNOR';
export type GiftReleaseStatus = 'DRAFT' | 'PUBLISHED' | 'CLOSED';
export type GiftOrderStatus =
  'CLAIMABLE' | 'SUBMITTED' | 'PROCESSING' | 'SHIPPED' | 'COMPLETED' | 'EXPIRED' | 'CANCELLED';

export interface GiftReleaseField {
  readonly key: string;
  readonly label: string;
  readonly type: 'TEXT' | 'TEXTAREA' | 'SELECT' | 'RADIO' | 'CHECKBOX';
  readonly required: boolean;
  readonly options?: readonly string[];
}

export interface GiftOrderPackageSnapshot {
  readonly name: string;
  readonly description: string;
  readonly items: readonly {
    readonly name: string;
    readonly description: string;
    readonly quantity: number;
  }[];
}

const timestamps = {
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
};

const encryptedColumns = {
  ciphertext: text('ciphertext').notNull(),
  initializationVector: text('initialization_vector').notNull(),
  authenticationTag: text('authentication_tag').notNull(),
  keyVersion: integer('key_version').notNull(),
};

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').default(false).notNull(),
    image: text('image'),
    role: text('role').default('USER').notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('users_email_unique').on(table.email),
    check('users_role_check', sql`${table.role} in ('USER', 'CREATOR', 'PLATFORM_ADMIN')`),
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
    archivedAt: timestamp('archived_at', { mode: 'date', withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('creators_user_unique').on(table.userId),
    uniqueIndex('creators_bilibili_uid_unique').on(table.bilibiliUid),
    uniqueIndex('creators_room_id_unique').on(table.roomId),
    index('creators_active_idx').on(table.active, table.archivedAt),
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
    biliOwnerUid: text('bili_owner_uid').notNull(),
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
    check(
      'snapshot_runs_status_check',
      sql`${table.status} in ('SCHEDULED', 'RUNNING', 'FAILED', 'PENDING_APPROVAL', 'FINALIZED', 'REJECTED')`,
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
    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('snapshot_attempts_run_number_unique').on(table.snapshotRunId, table.attemptNumber),
    index('snapshot_attempts_run_created_idx').on(table.snapshotRunId, table.createdAt),
    check(
      'snapshot_attempts_punctuality_check',
      sql`${table.punctuality} is null or ${table.punctuality} in ('ON_TIME', 'LATE')`,
    ),
    check(
      'snapshot_attempts_consistency_check',
      sql`${table.consistencyStatus} in ('PENDING', 'CONSISTENT', 'INCONSISTENT')`,
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
    pageNumber: integer('page_number').notNull(),
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
    uniqueIndex('snapshot_pages_attempt_page_unique').on(table.snapshotAttemptId, table.pageNumber),
    uniqueIndex('snapshot_pages_object_key_unique').on(table.objectKey),
    check('snapshot_pages_page_positive', sql`${table.pageNumber} > 0`),
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
    index('snapshot_members_bili_uid_idx').on(table.biliUid),
    check('snapshot_members_tier_check', sql`${table.tier} in ('CAPTAIN', 'ADMIRAL', 'GOVERNOR')`),
  ],
);

export const giftReleases = pgTable(
  'gift_releases',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id, { onDelete: 'restrict' }),
    eligibilityMonth: date('eligibility_month', { mode: 'string' }).notNull(),
    title: text('title').notNull(),
    description: text('description').default('').notNull(),
    coverObjectKey: text('cover_object_key'),
    claimStartAt: timestamp('claim_start_at', { mode: 'date', withTimezone: true }).notNull(),
    claimDeadlineAt: timestamp('claim_deadline_at', { mode: 'date', withTimezone: true }).notNull(),
    fulfillmentMode: text('fulfillment_mode').default('HIGHEST_ONLY').notNull(),
    formSchema: jsonb('form_schema').$type<readonly GiftReleaseField[]>().default([]).notNull(),
    status: text('status').default('DRAFT').notNull(),
    publishedAt: timestamp('published_at', { mode: 'date', withTimezone: true }),
    closedAt: timestamp('closed_at', { mode: 'date', withTimezone: true }),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('gift_releases_creator_month_unique').on(table.creatorId, table.eligibilityMonth),
    index('gift_releases_creator_status_idx').on(table.creatorId, table.status),
    check('gift_releases_status_check', sql`${table.status} in ('DRAFT', 'PUBLISHED', 'CLOSED')`),
    check(
      'gift_releases_fulfillment_mode_check',
      sql`${table.fulfillmentMode} in ('HIGHEST_ONLY', 'CUMULATIVE')`,
    ),
    check(
      'gift_releases_claim_window_check',
      sql`${table.claimDeadlineAt} > ${table.claimStartAt}`,
    ),
  ],
);

export const giftPackages = pgTable(
  'gift_packages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    giftReleaseId: uuid('gift_release_id')
      .notNull()
      .references(() => giftReleases.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').default('').notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('gift_packages_release_name_unique').on(table.giftReleaseId, table.name),
    index('gift_packages_release_sort_idx').on(table.giftReleaseId, table.sortOrder),
  ],
);

export const giftPackageItems = pgTable(
  'gift_package_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    giftPackageId: uuid('gift_package_id')
      .notNull()
      .references(() => giftPackages.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').default('').notNull(),
    quantity: integer('quantity').default(1).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    ...timestamps,
  },
  (table) => [
    index('gift_package_items_package_sort_idx').on(table.giftPackageId, table.sortOrder),
    check('gift_package_items_quantity_positive', sql`${table.quantity} > 0`),
  ],
);

export const giftTierRules = pgTable(
  'gift_tier_rules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    giftReleaseId: uuid('gift_release_id')
      .notNull()
      .references(() => giftReleases.id, { onDelete: 'cascade' }),
    tier: text('tier').notNull(),
    giftPackageId: uuid('gift_package_id')
      .notNull()
      .references(() => giftPackages.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('gift_tier_rules_release_tier_unique').on(table.giftReleaseId, table.tier),
    check('gift_tier_rules_tier_check', sql`${table.tier} in ('CAPTAIN', 'ADMIRAL', 'GOVERNOR')`),
  ],
);

export const giftOrders = pgTable(
  'gift_orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderNumber: text('order_number').notNull(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id, { onDelete: 'restrict' }),
    giftReleaseId: uuid('gift_release_id')
      .notNull()
      .references(() => giftReleases.id, { onDelete: 'restrict' }),
    snapshotMemberId: uuid('snapshot_member_id')
      .notNull()
      .references(() => snapshotMembers.id, { onDelete: 'restrict' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'restrict' }),
    biliUid: text('bili_uid').notNull(),
    biliDisplayName: text('bili_display_name').notNull(),
    tier: text('tier').notNull(),
    status: text('status').default('CLAIMABLE').notNull(),
    expiresAt: timestamp('expires_at', { mode: 'date', withTimezone: true }).notNull(),
    submittedAt: timestamp('submitted_at', { mode: 'date', withTimezone: true }),
    processingAt: timestamp('processing_at', { mode: 'date', withTimezone: true }),
    shippedAt: timestamp('shipped_at', { mode: 'date', withTimezone: true }),
    completedAt: timestamp('completed_at', { mode: 'date', withTimezone: true }),
    expiredAt: timestamp('expired_at', { mode: 'date', withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { mode: 'date', withTimezone: true }),
    cancelReason: text('cancel_reason'),
    version: integer('version').default(1).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('gift_orders_number_unique').on(table.orderNumber),
    uniqueIndex('gift_orders_release_member_unique').on(
      table.giftReleaseId,
      table.snapshotMemberId,
    ),
    uniqueIndex('gift_orders_release_uid_unique').on(table.giftReleaseId, table.biliUid),
    index('gift_orders_uid_updated_idx').on(table.biliUid, table.updatedAt),
    index('gift_orders_user_updated_idx').on(table.userId, table.updatedAt),
    index('gift_orders_creator_status_idx').on(table.creatorId, table.status),
    check(
      'gift_orders_status_check',
      sql`${table.status} in ('CLAIMABLE', 'SUBMITTED', 'PROCESSING', 'SHIPPED', 'COMPLETED', 'EXPIRED', 'CANCELLED')`,
    ),
    check('gift_orders_tier_check', sql`${table.tier} in ('CAPTAIN', 'ADMIRAL', 'GOVERNOR')`),
    check('gift_orders_version_positive', sql`${table.version} > 0`),
  ],
);

export const giftOrderItems = pgTable(
  'gift_order_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    giftOrderId: uuid('gift_order_id')
      .notNull()
      .references(() => giftOrders.id, { onDelete: 'restrict' }),
    giftPackageId: uuid('gift_package_id')
      .notNull()
      .references(() => giftPackages.id, { onDelete: 'restrict' }),
    packageSnapshot: jsonb('package_snapshot').$type<GiftOrderPackageSnapshot>().notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('gift_order_items_order_package_unique').on(table.giftOrderId, table.giftPackageId),
    index('gift_order_items_order_sort_idx').on(table.giftOrderId, table.sortOrder),
  ],
);

export const addresses = pgTable(
  'addresses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    isDefault: boolean('is_default').default(false).notNull(),
    ...encryptedColumns,
    ...timestamps,
  },
  (table) => [
    index('addresses_user_created_idx').on(table.userId, table.createdAt),
    uniqueIndex('addresses_user_default_unique')
      .on(table.userId)
      .where(sql`${table.isDefault} = true`),
    check('addresses_key_version_positive', sql`${table.keyVersion} > 0`),
  ],
);

export const giftOrderAddresses = pgTable(
  'gift_order_addresses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    giftOrderId: uuid('gift_order_id')
      .notNull()
      .references(() => giftOrders.id, { onDelete: 'restrict' }),
    sourceAddressId: uuid('source_address_id').references(() => addresses.id, {
      onDelete: 'set null',
    }),
    ...encryptedColumns,
    ...timestamps,
  },
  (table) => [
    uniqueIndex('gift_order_addresses_order_unique').on(table.giftOrderId),
    check('gift_order_addresses_key_version_positive', sql`${table.keyVersion} > 0`),
  ],
);

export const giftOrderOptionValues = pgTable(
  'gift_order_option_values',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    giftOrderId: uuid('gift_order_id')
      .notNull()
      .references(() => giftOrders.id, { onDelete: 'restrict' }),
    fieldKey: text('field_key').notNull(),
    fieldLabel: text('field_label').notNull(),
    ...encryptedColumns,
    ...timestamps,
  },
  (table) => [
    uniqueIndex('gift_order_option_values_order_key_unique').on(table.giftOrderId, table.fieldKey),
    check('gift_order_option_values_key_version_positive', sql`${table.keyVersion} > 0`),
  ],
);

export const giftOrderStatusHistory = pgTable(
  'gift_order_status_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    giftOrderId: uuid('gift_order_id')
      .notNull()
      .references(() => giftOrders.id, { onDelete: 'restrict' }),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    reason: text('reason'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('gift_order_status_history_order_created_idx').on(table.giftOrderId, table.createdAt),
    check(
      'gift_order_status_history_from_check',
      sql`${table.fromStatus} is null or ${table.fromStatus} in ('CLAIMABLE', 'SUBMITTED', 'PROCESSING', 'SHIPPED', 'COMPLETED', 'EXPIRED', 'CANCELLED')`,
    ),
    check(
      'gift_order_status_history_to_check',
      sql`${table.toStatus} in ('CLAIMABLE', 'SUBMITTED', 'PROCESSING', 'SHIPPED', 'COMPLETED', 'EXPIRED', 'CANCELLED')`,
    ),
  ],
);

export const shipments = pgTable(
  'shipments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    shipmentNumber: text('shipment_number').notNull(),
    shipmentKey: text('shipment_key').notNull(),
    giftOrderId: uuid('gift_order_id')
      .notNull()
      .references(() => giftOrders.id, { onDelete: 'restrict' }),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id, { onDelete: 'restrict' }),
    carrierCode: text('carrier_code').notNull(),
    carrierName: text('carrier_name').notNull(),
    trackingNumber: text('tracking_number').notNull(),
    trackingUrl: text('tracking_url'),
    status: text('status').default('LABEL_CREATED').notNull(),
    deliveredAt: timestamp('delivered_at', { mode: 'date', withTimezone: true }),
    lastTrackingRefreshAt: timestamp('last_tracking_refresh_at', {
      mode: 'date',
      withTimezone: true,
    }),
    nextTrackingRefreshAt: timestamp('next_tracking_refresh_at', {
      mode: 'date',
      withTimezone: true,
    }),
    exceptionMessage: text('exception_message'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('shipments_number_unique').on(table.shipmentNumber),
    uniqueIndex('shipments_order_key_unique').on(table.giftOrderId, table.shipmentKey),
    index('shipments_creator_status_idx').on(table.creatorId, table.status),
    index('shipments_tracking_due_idx').on(table.nextTrackingRefreshAt),
    check(
      'shipments_status_check',
      sql`${table.status} in ('LABEL_CREATED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION')`,
    ),
    check(
      'shipments_tracking_identity_check',
      sql`length(${table.shipmentKey}) between 1 and 120 and length(${table.carrierCode}) between 1 and 80 and length(${table.trackingNumber}) between 1 and 160`,
    ),
  ],
);

export const shipmentItems = pgTable(
  'shipment_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    shipmentId: uuid('shipment_id')
      .notNull()
      .references(() => shipments.id, { onDelete: 'restrict' }),
    giftOrderItemId: uuid('gift_order_item_id')
      .notNull()
      .references(() => giftOrderItems.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('shipment_items_shipment_order_item_unique').on(
      table.shipmentId,
      table.giftOrderItemId,
    ),
    uniqueIndex('shipment_items_order_item_unique').on(table.giftOrderItemId),
  ],
);

export const trackingEvents = pgTable(
  'tracking_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    shipmentId: uuid('shipment_id')
      .notNull()
      .references(() => shipments.id, { onDelete: 'restrict' }),
    providerEventId: text('provider_event_id').notNull(),
    status: text('status').notNull(),
    description: text('description').notNull(),
    location: text('location'),
    occurredAt: timestamp('occurred_at', { mode: 'date', withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('tracking_events_shipment_provider_unique').on(
      table.shipmentId,
      table.providerEventId,
    ),
    index('tracking_events_shipment_occurred_idx').on(table.shipmentId, table.occurredAt),
    check(
      'tracking_events_status_check',
      sql`${table.status} in ('LABEL_CREATED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION')`,
    ),
  ],
);

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

export const idempotencyRecords = pgTable(
  'idempotency_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body').$type<Record<string, unknown> | null>(),
    expiresAt: timestamp('expires_at', { mode: 'date', withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('idempotency_records_actor_scope_key_unique').on(
      table.actorUserId,
      table.scope,
      table.key,
    ),
    index('idempotency_records_expiry_idx').on(table.expiresAt),
    check('idempotency_records_hash_check', sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const schema = {
  accounts,
  addresses,
  announcementReads,
  announcements,
  auditLogs,
  bilibiliBindings,
  bindingChallenges,
  creators,
  giftOrderAddresses,
  giftOrderItems,
  giftOrderOptionValues,
  giftOrders,
  giftOrderStatusHistory,
  giftPackageItems,
  giftPackages,
  giftReleases,
  giftTierRules,
  idempotencyRecords,
  sessions,
  shipmentItems,
  shipments,
  snapshotAttemptMembers,
  snapshotAttempts,
  snapshotMembers,
  snapshotPages,
  snapshotRuns,
  trackingEvents,
  users,
  verifications,
  verificationRooms,
};

export type AppSchema = typeof schema;
