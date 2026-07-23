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
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
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
    index('snapshot_runs_organization_period_idx').on(table.organizationId, table.periodStart),
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

export interface CampaignClaimField {
  readonly key: string;
  readonly label: string;
  readonly options?: readonly string[];
  readonly required: boolean;
  readonly type: 'TEXT' | 'LONG_TEXT' | 'SELECT';
}

export const giftCampaigns = pgTable(
  'gift_campaigns',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id, { onDelete: 'restrict' }),
    periodStart: date('period_start', { mode: 'string' }).notNull(),
    title: text('title').notNull(),
    description: text('description').default('').notNull(),
    coverFileId: uuid('cover_file_id'),
    claimStartAt: timestamp('claim_start_at', { mode: 'date', withTimezone: true }).notNull(),
    claimDeadlineAt: timestamp('claim_deadline_at', { mode: 'date', withTimezone: true }).notNull(),
    fulfillmentMode: text('fulfillment_mode').notNull(),
    claimFormSchema: jsonb('claim_form_schema').$type<readonly CampaignClaimField[]>().notNull(),
    status: text('status').default('DRAFT').notNull(),
    publishedAt: timestamp('published_at', { mode: 'date', withTimezone: true }),
    closedAt: timestamp('closed_at', { mode: 'date', withTimezone: true }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('gift_campaigns_creator_period_unique').on(table.creatorId, table.periodStart),
    index('gift_campaigns_organization_status_idx').on(table.organizationId, table.status),
    check(
      'gift_campaigns_status_check',
      sql`${table.status} in ('DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED')`,
    ),
    check(
      'gift_campaigns_fulfillment_mode_check',
      sql`${table.fulfillmentMode} in ('HIGHEST_ONLY', 'CUMULATIVE')`,
    ),
    check(
      'gift_campaigns_claim_window_check',
      sql`${table.claimDeadlineAt} > ${table.claimStartAt}`,
    ),
  ],
);

export const giftPackages = pgTable(
  'gift_packages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => giftCampaigns.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description').default('').notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('gift_packages_campaign_name_unique').on(table.campaignId, table.name),
    index('gift_packages_campaign_sort_idx').on(table.campaignId, table.sortOrder),
  ],
);

export const giftPackageItems = pgTable(
  'gift_package_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    giftPackageId: uuid('gift_package_id')
      .notNull()
      .references(() => giftPackages.id, { onDelete: 'restrict' }),
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
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => giftCampaigns.id, { onDelete: 'restrict' }),
    tier: text('tier').notNull(),
    giftPackageId: uuid('gift_package_id')
      .notNull()
      .references(() => giftPackages.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('gift_tier_rules_campaign_tier_unique').on(table.campaignId, table.tier),
    check('gift_tier_rules_tier_check', sql`${table.tier} in ('CAPTAIN', 'ADMIRAL', 'GOVERNOR')`),
  ],
);

export const entitlements = pgTable(
  'entitlements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id, { onDelete: 'restrict' }),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => giftCampaigns.id, { onDelete: 'restrict' }),
    snapshotMemberId: uuid('snapshot_member_id')
      .notNull()
      .references(() => snapshotMembers.id, { onDelete: 'restrict' }),
    giftPackageId: uuid('gift_package_id')
      .notNull()
      .references(() => giftPackages.id, { onDelete: 'restrict' }),
    biliUid: text('bili_uid').notNull(),
    tier: text('tier').notNull(),
    revokedAt: timestamp('revoked_at', { mode: 'date', withTimezone: true }),
    revokedBy: uuid('revoked_by').references(() => users.id, { onDelete: 'set null' }),
    revokeReason: text('revoke_reason'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('entitlements_campaign_member_package_unique').on(
      table.campaignId,
      table.snapshotMemberId,
      table.giftPackageId,
    ),
    index('entitlements_bili_uid_idx').on(table.biliUid),
    index('entitlements_campaign_revoked_idx').on(table.campaignId, table.revokedAt),
    check('entitlements_tier_check', sql`${table.tier} in ('CAPTAIN', 'ADMIRAL', 'GOVERNOR')`),
    check(
      'entitlements_revocation_check',
      sql`(${table.revokedAt} is null and ${table.revokedBy} is null and ${table.revokeReason} is null) or (${table.revokedAt} is not null and ${table.revokedBy} is not null and length(${table.revokeReason}) >= 3)`,
    ),
  ],
);

export const schema = {
  accounts,
  auditLogs,
  bilibiliBindings,
  bindingChallenges,
  creators,
  entitlements,
  giftCampaigns,
  giftPackageItems,
  giftPackages,
  giftTierRules,
  memberCreatorScopes,
  organizationMembers,
  organizations,
  sessions,
  snapshotAttemptMembers,
  snapshotAttempts,
  snapshotMembers,
  snapshotPages,
  snapshotRuns,
  users,
  verifications,
  verificationRooms,
};

export type AppSchema = typeof schema;
