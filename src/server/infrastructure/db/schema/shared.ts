import { integer, text, timestamp } from 'drizzle-orm/pg-core';

export type { AccountRole, GuardTier } from '../../../../shared/contracts/common.js';
export type { GiftOrderStatus } from '../../../../shared/contracts/gifts.js';

export type { GiftFormField as GiftReleaseField } from '../../../../shared/contracts/gifts.js';
export type StoredGiftOrderStatus = 'UNCLAIMED' | 'SUBMITTED' | 'SHIPPED' | 'CANCELLED';

export const timestamps = {
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
};

export const encryptedColumns = {
  ciphertext: text('ciphertext').notNull(),
  initializationVector: text('initialization_vector').notNull(),
  authenticationTag: text('authentication_tag').notNull(),
  keyVersion: integer('key_version').notNull(),
};
