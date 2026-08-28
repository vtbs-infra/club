import { resolve } from 'node:path';

import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  createDatabase,
  type DatabaseService,
} from '../../src/server/infrastructure/db/database.js';
import { migrateDatabase } from '../../src/server/infrastructure/db/migration-runner.js';
import { integration, integrationDatabaseUrl } from '../helpers/integration-database.js';

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
        'bilibili_bindings',
        'creators',
        'snapshot_runs',
        'snapshot_pages',
        'gift_releases',
        'gift_orders',
        'gift_order_addresses',
        'shipments',
        'announcements',
        'platform_appearance',
      ]) {
        expect(await tableExists(database, table), table).toBe(true);
      }
      expect(await tableExists(database, 'idempotency_records')).toBe(false);
      expect(await tableExists(database, 'shipment_items')).toBe(false);
      expect(await columnExists(database, 'creators', 'binding_id')).toBe(true);
      expect(await columnExists(database, 'creators', 'active')).toBe(false);
      expect(await columnExists(database, 'creators', 'archived_at')).toBe(false);
      expect(await columnExists(database, 'gift_orders', 'processing_at')).toBe(false);
      expect(await columnExists(database, 'announcement_reads', 'announcement_version')).toBe(true);
      expect(await columnExists(database, 'snapshot_attempts', 'initiated_by')).toBe(true);
      expect(await columnExists(database, 'snapshot_pages', 'capture_kind')).toBe(true);
      expect(await columnExists(database, 'verification_rooms', 'bili_owner_uid')).toBe(false);
      for (const trigger of [
        'announcement_reads_append_only',
        'announcements_lifecycle',
        'audit_logs_append_only',
        'gift_order_addresses_append_only',
        'gift_order_items_append_only',
        'gift_order_option_values_append_only',
        'gift_order_status_history_append_only',
        'gift_orders_lifecycle',
        'gift_package_items_published_immutability',
        'gift_packages_published_immutability',
        'gift_releases_lifecycle',
        'gift_tier_rules_published_immutability',
        'shipments_lifecycle',
        'snapshot_attempt_members_append_only',
        'snapshot_attempts_preserve_completed',
        'snapshot_members_prevent_finalized_delete',
        'snapshot_members_prevent_finalized_update',
        'snapshot_pages_append_only',
        'snapshot_runs_preserve_finalized',
        'tracking_events_append_only',
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

      const [appliedMigration] = await database.orm.execute<{ createdAt: string; id: number }>(sql`
        select id, created_at::text as "createdAt"
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
        'Database schema migration version does not match this application.',
      );
      await database.orm.execute(sql`
        update drizzle.__drizzle_migrations
        set created_at = ${appliedMigration!.createdAt}
        where id = ${appliedMigration!.id}
      `);

      await database.orm.execute(sql`
        insert into drizzle.__drizzle_migrations (hash, created_at)
        values ('unexpected-migration', 9999999999999)
      `);
      await expect(database.checkSchema()).rejects.toThrow(
        'Database schema migration version does not match this application.',
      );
    } finally {
      await database.close();
    }
  });
});
