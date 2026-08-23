import { sql } from 'drizzle-orm';
import {
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

import { users } from './auth.js';
import { creators } from './identity.js';
import {
  encryptedColumns,
  type GiftOrderPackageSnapshot,
  type GiftReleaseField,
  timestamps,
} from './shared.js';
import { snapshotMembers } from './snapshots.js';

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
    publicVisible: boolean('public_visible').default(false).notNull(),
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
    version: integer('version').default(1).notNull(),
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
    check('gift_releases_version_positive', sql`${table.version} > 0`),
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
      sql`${table.status} in ('CLAIMABLE', 'SUBMITTED', 'SHIPPED', 'COMPLETED', 'EXPIRED', 'CANCELLED')`,
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
    sourceAddressId: uuid('source_address_id'),
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
      sql`${table.fromStatus} is null or ${table.fromStatus} in ('CLAIMABLE', 'SUBMITTED', 'SHIPPED', 'COMPLETED', 'EXPIRED', 'CANCELLED')`,
    ),
    check(
      'gift_order_status_history_to_check',
      sql`${table.toStatus} in ('CLAIMABLE', 'SUBMITTED', 'SHIPPED', 'COMPLETED', 'EXPIRED', 'CANCELLED')`,
    ),
  ],
);

export const shipments = pgTable(
  'shipments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    shipmentNumber: text('shipment_number').notNull(),
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
    trackingFailureCount: integer('tracking_failure_count').default(0).notNull(),
    lastTrackingError: text('last_tracking_error'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('shipments_number_unique').on(table.shipmentNumber),
    uniqueIndex('shipments_order_unique').on(table.giftOrderId),
    index('shipments_creator_status_idx').on(table.creatorId, table.status),
    index('shipments_tracking_due_idx').on(table.nextTrackingRefreshAt),
    check(
      'shipments_status_check',
      sql`${table.status} in ('LABEL_CREATED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION')`,
    ),
    check(
      'shipments_tracking_identity_check',
      sql`length(${table.carrierCode}) between 1 and 80 and length(${table.trackingNumber}) between 1 and 160`,
    ),
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
