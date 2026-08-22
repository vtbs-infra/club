import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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

  it('creates the application schema on an empty database', async () => {
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
        'platform_appearance',
        'site_pages',
        'site_page_versions',
        'site_assets',
      ]) {
        expect(await tableExists(database, table), table).toBe(true);
      }
      expect(await tableExists(database, 'idempotency_records')).toBe(false);
      expect(await columnExists(database, 'creators', 'archived_at')).toBe(false);
      expect(await columnExists(database, 'verification_rooms', 'bili_owner_uid')).toBe(false);
      const migrations = await database.orm.execute<{ value: number }>(
        sql`select count(*)::int as value from drizzle.__drizzle_migrations`,
      );
      expect(migrations[0]?.value).toBeGreaterThan(0);
    } finally {
      await database.close();
    }
  });

  it('converts legacy processing orders and history on upgrade', async () => {
    const database = await temporaryDatabase();
    const sourceFolder = resolve('migrations');
    const legacyFolder = await mkdtemp(join(tmpdir(), 'club-legacy-migrations-'));
    try {
      await mkdir(join(legacyFolder, 'meta'));
      const journal = JSON.parse(
        await readFile(join(sourceFolder, 'meta', '_journal.json'), 'utf8'),
      ) as {
        entries: { readonly idx: number; readonly tag: string }[];
      };
      journal.entries = journal.entries.filter((entry) => entry.idx < 7);
      await writeFile(
        join(legacyFolder, 'meta', '_journal.json'),
        `${JSON.stringify(journal, null, 2)}\n`,
      );
      for (const entry of journal.entries) {
        await copyFile(
          join(sourceFolder, `${entry.tag}.sql`),
          join(legacyFolder, `${entry.tag}.sql`),
        );
      }
      await migrateDatabase(database, legacyFolder);

      await database.orm.execute(sql`
        insert into users (id, name, email, role)
        values
          (
            '60000000-0000-4000-8000-000000000001',
            'Legacy creator',
            'legacy-creator@example.com',
            'CREATOR'
          ),
          (
            '50000000-0000-4000-8000-000000000001',
            'Legacy recipient',
            'legacy-recipient@example.com',
            'USER'
          )
      `);
      await database.orm.execute(sql`
        insert into creators (id, user_id, bilibili_uid, room_id, display_name)
        values (
          '20000000-0000-4000-8000-000000000001',
          '60000000-0000-4000-8000-000000000001',
          'legacy-creator-uid',
          'legacy-room',
          'Legacy creator'
        )
      `);
      await database.orm.execute(sql`
        insert into snapshot_runs (
          id,
          creator_id,
          creator_bilibili_uid,
          creator_room_id,
          period_start,
          cutoff_timezone,
          scheduled_cutoff_at,
          on_time_window_end_at
        ) values (
          '70000000-0000-4000-8000-000000000001',
          '20000000-0000-4000-8000-000000000001',
          'legacy-creator-uid',
          'legacy-room',
          '2026-06-01',
          'Asia/Shanghai',
          '2026-06-30T15:59:00Z',
          '2026-06-30T16:10:00Z'
        )
      `);
      await database.orm.execute(sql`
        insert into snapshot_members (
          id,
          snapshot_run_id,
          bili_uid,
          display_name_at_snapshot,
          tier,
          raw_tier,
          source_position
        ) values (
          '40000000-0000-4000-8000-000000000001',
          '70000000-0000-4000-8000-000000000001',
          'legacy-uid',
          'Legacy recipient',
          'CAPTAIN',
          '3',
          1
        )
      `);
      await database.orm.execute(sql`
        insert into gift_releases (
          id,
          creator_id,
          eligibility_month,
          title,
          claim_start_at,
          claim_deadline_at,
          created_by_user_id
        ) values (
          '30000000-0000-4000-8000-000000000001',
          '20000000-0000-4000-8000-000000000001',
          '2026-06-01',
          'Legacy release',
          '2026-07-01T00:00:00Z',
          '2026-08-01T00:00:00Z',
          '60000000-0000-4000-8000-000000000001'
        )
      `);
      await database.orm.execute(sql`
        insert into gift_orders (
          id,
          order_number,
          creator_id,
          gift_release_id,
          snapshot_member_id,
          user_id,
          bili_uid,
          bili_display_name,
          tier,
          status,
          expires_at,
          submitted_at,
          processing_at,
          version
        ) values (
          '10000000-0000-4000-8000-000000000001',
          'LEGACY-PROCESSING-1',
          '20000000-0000-4000-8000-000000000001',
          '30000000-0000-4000-8000-000000000001',
          '40000000-0000-4000-8000-000000000001',
          '50000000-0000-4000-8000-000000000001',
          'legacy-uid',
          'Legacy recipient',
          'CAPTAIN',
          'PROCESSING',
          now() + interval '30 days',
          now() - interval '2 days',
          now() - interval '1 day',
          3
        )
      `);
      await database.orm.execute(sql`
        insert into gift_order_status_history (id, gift_order_id, from_status, to_status)
        values
          (
            '11000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001',
            null,
            'CLAIMABLE'
          ),
          (
            '11000000-0000-4000-8000-000000000002',
            '10000000-0000-4000-8000-000000000001',
            'CLAIMABLE',
            'SUBMITTED'
          ),
          (
            '11000000-0000-4000-8000-000000000003',
            '10000000-0000-4000-8000-000000000001',
            'SUBMITTED',
            'PROCESSING'
          )
      `);

      await migrateDatabase(database, sourceFolder);

      const orders = await database.orm.execute<{ status: string }>(sql`
        select status
        from gift_orders
        where id = '10000000-0000-4000-8000-000000000001'
      `);
      expect(orders[0]?.status).toBe('SUBMITTED');
      const history = await database.orm.execute<{
        fromStatus: null | string;
        toStatus: string;
      }>(sql`
        select from_status as "fromStatus", to_status as "toStatus"
        from gift_order_status_history
        where gift_order_id = '10000000-0000-4000-8000-000000000001'
        order by id
      `);
      expect(history).toEqual([
        { fromStatus: null, toStatus: 'CLAIMABLE' },
        { fromStatus: 'CLAIMABLE', toStatus: 'SUBMITTED' },
      ]);
      expect(await columnExists(database, 'gift_orders', 'processing_at')).toBe(false);
    } finally {
      await database.close();
      await rm(legacyFolder, { force: true, recursive: true });
    }
  });
});
