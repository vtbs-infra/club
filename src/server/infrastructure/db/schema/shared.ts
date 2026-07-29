import { integer, text, timestamp } from 'drizzle-orm/pg-core';

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
