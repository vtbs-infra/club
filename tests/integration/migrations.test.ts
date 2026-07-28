import { resolve } from 'node:path';

import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDatabase,
  type DatabaseService,
} from '../../src/server/infrastructure/db/database.js';
import { migrateDatabase } from '../../src/server/infrastructure/db/migration-runner.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;

integration('database migration baseline', () => {
  let admin: ReturnType<typeof postgres>;
  const databases: string[] = [];

  beforeAll(() => {
    const adminUrl = new URL(testDatabaseUrl!);
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
    const targetUrl = new URL(testDatabaseUrl!);
    targetUrl.pathname = `/${name}`;
    return createDatabase(targetUrl.toString());
  }

  async function tableExists(database: DatabaseService, tableName: string): Promise<boolean> {
    const rows = await database.orm.execute<{ exists: boolean }>(
      sql`select to_regclass(${`public.${tableName}`}) is not null as exists`,
    );
    return Boolean(rows[0]?.exists);
  }

  it('creates only the creator-first target model on an empty database', async () => {
    const database = await temporaryDatabase();
    try {
      await migrateDatabase(database, resolve('migrations'));
      for (const table of [
        'users',
        'creators',
        'snapshot_runs',
        'snapshot_pages',
        'gift_releases',
        'gift_orders',
        'gift_order_addresses',
        'shipments',
        'announcements',
      ]) {
        expect(await tableExists(database, table), table).toBe(true);
      }
      for (const removed of [
        'organizations',
        'organization_members',
        'campaigns',
        'entitlements',
        'claims',
        'platform_appearance',
        'site_pages',
        'site_assets',
      ]) {
        expect(await tableExists(database, removed), removed).toBe(false);
      }
      const migrations = await database.orm.execute<{ value: number }>(
        sql`select count(*)::int as value from drizzle.__drizzle_migrations`,
      );
      expect(migrations[0]?.value).toBe(1);
    } finally {
      await database.close();
    }
  });
});
