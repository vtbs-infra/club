import { accounts, sessions, users, verifications } from './auth.js';
import { platformAppearance } from './appearance.js';
import { announcementReads, announcements } from './announcements.js';
import {
  addresses,
  giftCoverObjects,
  giftOrderAddresses,
  giftOrderItems,
  giftOrderOptionValues,
  giftOrders,
  giftOrderStatusHistory,
  giftPackageItems,
  giftPackages,
  giftReleases,
  giftTierRules,
  shipments,
  trackingEvents,
} from './gifts.js';
import {
  auditLogs,
  bilibiliBindings,
  bindingChallenges,
  bindingConflicts,
  creators,
  verificationRooms,
} from './identity.js';
import {
  snapshotAttemptMembers,
  snapshotAttempts,
  snapshotMembers,
  snapshotPages,
  snapshotRuns,
} from './snapshots.js';

export * from './announcements.js';
export * from './appearance.js';
export * from './auth.js';
export * from './gifts.js';
export * from './identity.js';
export * from './shared.js';
export * from './snapshots.js';

export const schema = {
  accounts,
  addresses,
  announcementReads,
  announcements,
  platformAppearance,
  auditLogs,
  bilibiliBindings,
  bindingChallenges,
  bindingConflicts,
  creators,
  giftCoverObjects,
  giftOrderAddresses,
  giftOrderItems,
  giftOrderOptionValues,
  giftOrders,
  giftOrderStatusHistory,
  giftPackageItems,
  giftPackages,
  giftReleases,
  giftTierRules,
  sessions,
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
