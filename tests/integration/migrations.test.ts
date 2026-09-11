import { resolve } from 'node:path';

import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it, describe as integration } from 'vitest';

import {
  createDatabase,
  type DatabaseService,
} from '../../src/server/infrastructure/db/database.js';
import { migrateDatabase } from '../../src/server/infrastructure/db/migration-runner.js';
import { integrationDatabaseUrl } from '../helpers/integration-database.js';

integration('database migration baseline', () => {
  let admin: ReturnType<typeof postgres>;
  const databases: string[] = [];

  beforeAll(() => {
    const adminUrl = new URL(integrationDatabaseUrl());
    adminUrl.pathname = '/postgres';
    admin = postgres(adminUrl.toString(), { max: 1 });
  });

  afterAll(async () => {
    for (const name of databases) {
      await admin`
        select pg_terminate_backend(pid)
        from pg_stat_activity
        where datname = ${name} and pid <> pg_backend_pid()
      `;
      await admin.unsafe(`drop database if exists "${name}"`);
    }
    await admin.end({ timeout: 5 });
  });

  async function temporaryDatabase(): Promise<DatabaseService> {
    const name = `club_baseline_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
    await admin.unsafe(`create database "${name}"`);
    databases.push(name);
    const targetUrl = new URL(integrationDatabaseUrl());
    targetUrl.pathname = `/${name}`;
    return createDatabase(targetUrl.toString());
  }

  async function tableExists(database: DatabaseService, tableName: string): Promise<boolean> {
    const rows = await database.orm.execute<{ exists: boolean }>(
      sql`select to_regclass(${`public.${tableName}`}) is not null as exists`,
    );
    return Boolean(rows[0]?.exists);
  }

  async function columnExists(
    database: DatabaseService,
    tableName: string,
    columnName: string,
  ): Promise<boolean> {
    const rows = await database.orm.execute<{ exists: boolean }>(
      sql`select exists(
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = ${tableName}
          and column_name = ${columnName}
      ) as exists`,
    );
    return Boolean(rows[0]?.exists);
  }

  async function triggerExists(database: DatabaseService, triggerName: string): Promise<boolean> {
    const rows = await database.orm.execute<{ exists: boolean }>(sql`
      select exists(
        select 1
        from pg_trigger
        where not tgisinternal and tgname = ${triggerName}
      ) as exists
    `);
    return Boolean(rows[0]?.exists);
  }

  it('creates the complete application schema on an empty database', async () => {
    const database = await temporaryDatabase();
    try {
      await migrateDatabase(database, resolve('migrations'));
      for (const table of [
        'users',
        'password_credentials',
        'sessions',
        'identity_challenges',
        'creators',
        'snapshot_runs',
        'snapshot_pages',
        'gift_releases',
        'gift_cover_objects',
        'gift_orders',
        'gift_order_addresses',
        'announcements',
        'platform_appearance',
      ]) {
        expect(await tableExists(database, table), table).toBe(true);
      }
      expect(await tableExists(database, 'idempotency_records')).toBe(false);
      expect(await tableExists(database, 'shipment_items')).toBe(false);
      expect(await columnExists(database, 'creators', 'binding_id')).toBe(false);
      expect(await columnExists(database, 'users', 'username')).toBe(true);
      expect(await columnExists(database, 'users', 'bilibili_uid')).toBe(true);
      expect(await columnExists(database, 'creators', 'active')).toBe(false);
      expect(await columnExists(database, 'creators', 'archived_at')).toBe(false);
      expect(await columnExists(database, 'gift_orders', 'processing_at')).toBe(false);
      expect(await columnExists(database, 'gift_releases', 'cover_object_key')).toBe(false);
      expect(await tableExists(database, 'shipments')).toBe(false);
      expect(await tableExists(database, 'tracking_events')).toBe(false);
      expect(await tableExists(database, 'snapshot_members')).toBe(false);
      expect(await columnExists(database, 'gift_order_items', 'package_snapshot')).toBe(false);
      expect(await columnExists(database, 'gift_orders', 'carrier_name')).toBe(true);
      expect(await columnExists(database, 'shipments', 'status')).toBe(false);
      expect(await columnExists(database, 'announcement_reads', 'announcement_version')).toBe(true);
      expect(await columnExists(database, 'announcements', 'status')).toBe(true);
      expect(await columnExists(database, 'announcements', 'withdrawn_at')).toBe(true);
      expect(await columnExists(database, 'snapshot_attempts', 'initiated_by')).toBe(true);
      expect(await columnExists(database, 'snapshot_pages', 'capture_kind')).toBe(true);
      expect(await columnExists(database, 'verification_rooms', 'bili_owner_uid')).toBe(false);
      for (const trigger of [
        'announcement_reads_append_only',
        'announcements_lifecycle',
        'audit_logs_append_only',
        'users_preserve_identity',
        'gift_order_addresses_append_only',
        'gift_order_items_append_only',
        'gift_order_option_values_append_only',
        'gift_order_status_history_append_only',
        'gift_orders_lifecycle',
        'gift_cover_objects_lifecycle',
        'gift_package_items_published_immutability',
        'gift_packages_published_immutability',
        'gift_releases_lifecycle',
        'gift_tier_rules_published_immutability',
        'snapshot_attempt_members_append_only',
        'snapshot_attempts_preserve_completed',
        'snapshot_attempt_members_sealed',
        'snapshot_pages_sealed',
        'snapshot_runs_accepted_attempt',
        'snapshot_pages_append_only',
        'snapshot_runs_preserve_finalized',
      ]) {
        expect(await triggerExists(database, trigger), trigger).toBe(true);
      }
      const appearance = await database.orm.execute<{ themePreset: string }>(sql`
        select theme_preset as "themePreset"
        from platform_appearance
        where id = 'global'
      `);
      expect(appearance).toEqual([{ themePreset: 'moe' }]);
      const migrations = await database.orm.execute<{ value: number }>(
        sql`select count(*)::int as value from drizzle.__drizzle_migrations`,
      );
      expect(migrations[0]?.value).toBe(1);
      await expect(database.checkSchema()).resolves.toBeUndefined();
      await expect(migrateDatabase(database, resolve('migrations'))).resolves.toBeUndefined();
      expect(
        await database.orm.execute(
          sql`select count(*)::int as value from drizzle.__drizzle_migrations`,
        ),
      ).toEqual([{ value: 1 }]);

      const [appliedMigration] = await database.orm.execute<{
        createdAt: string;
        hash: string;
        id: number;
      }>(sql`
        select id, created_at::text as "createdAt", hash
        from drizzle.__drizzle_migrations
        order by id
        limit 1
      `);
      expect(appliedMigration).toBeDefined();
      await database.orm.execute(sql`
        update drizzle.__drizzle_migrations
        set created_at = 9999999999998
        where id = ${appliedMigration!.id}
      `);
      await expect(database.checkSchema()).rejects.toThrow(
        'Database schema migration identity does not match this application.',
      );
      await database.orm.execute(sql`
        update drizzle.__drizzle_migrations
        set created_at = ${appliedMigration!.createdAt}
        where id = ${appliedMigration!.id}
      `);

      await database.orm.execute(sql`
        update drizzle.__drizzle_migrations
        set hash = 'unexpected-migration-hash'
        where id = ${appliedMigration!.id}
      `);
      await expect(database.checkSchema()).rejects.toThrow(
        'Database schema migration identity does not match this application.',
      );
      await database.orm.execute(sql`
        update drizzle.__drizzle_migrations
        set hash = ${appliedMigration!.hash}
        where id = ${appliedMigration!.id}
      `);

      await database.orm.execute(sql`
        insert into drizzle.__drizzle_migrations (hash, created_at)
        values ('unexpected-migration', 9999999999999)
      `);
      await expect(database.checkSchema()).rejects.toThrow(
        'Database schema migration identity does not match this application.',
      );
    } finally {
      await database.close();
    }
  });

  it('refuses nonempty databases without changing existing data or creating auth tables', async () => {
    const database = await temporaryDatabase();
    try {
      await database.orm.execute(sql`create table legacy_accounts (id text primary key)`);
      await database.orm.execute(sql`insert into legacy_accounts values ('preserve-me')`);
      await expect(migrateDatabase(database, resolve('migrations'))).rejects.toThrow(
        'Existing databases are not migrated or erased',
      );
      expect(await database.orm.execute(sql`select * from legacy_accounts`)).toEqual([
        { id: 'preserve-me' },
      ]);
      expect(await tableExists(database, 'users')).toBe(false);
      expect(await tableExists(database, 'password_credentials')).toBe(false);
    } finally {
      await database.close();
    }
  });
});
