import { passwordCredentials, sessions, users } from './auth.js';
import { bilibiliLoginAttempts, bilibiliSessions } from './bilibili.js';
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
} from './gifts.js';
import { auditLogs, identityChallenges, creators, verificationRooms } from './identity.js';
import {
  snapshotAttemptMembers,
  snapshotAttempts,
  snapshotPages,
  snapshotRuns,
} from './snapshots.js';

export * from './announcements.js';
export * from './appearance.js';
export * from './auth.js';
export * from './bilibili.js';
export * from './gifts.js';
export * from './identity.js';
export * from './shared.js';
export * from './snapshots.js';

export const schema = {
  bilibiliLoginAttempts,
  bilibiliSessions,
  passwordCredentials,
  addresses,
  announcementReads,
  announcements,
  platformAppearance,
  auditLogs,
  identityChallenges,
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
  snapshotAttemptMembers,
  snapshotAttempts,
  snapshotPages,
  snapshotRuns,
  users,
  verificationRooms,
};

export type AppSchema = typeof schema;
