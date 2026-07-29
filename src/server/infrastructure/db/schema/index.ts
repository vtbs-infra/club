import { accounts, sessions, users, verifications } from './auth.js';
import { announcementReads, announcements } from './announcements.js';
import {
  addresses,
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
import { platformAppearance, siteAssets, sitePages, sitePageVersions } from './site.js';

export * from './announcements.js';
export * from './auth.js';
export * from './gifts.js';
export * from './identity.js';
export * from './shared.js';
export * from './site.js';
export * from './snapshots.js';

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
  platformAppearance,
  sessions,
  siteAssets,
  sitePages,
  sitePageVersions,
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
