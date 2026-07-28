import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDatabase,
  type DatabaseService,
} from '../../src/server/infrastructure/db/database.js';
import { migrateDatabase } from '../../src/server/infrastructure/db/migration-runner.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;

interface MigrationJournal {
  readonly dialect: string;
  readonly entries: readonly {
    readonly breakpoints: boolean;
    readonly idx: number;
    readonly tag: string;
    readonly version: string;
    readonly when: number;
  }[];
  readonly version: string;
}

integration('database migration lifecycle', () => {
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

  async function temporaryDatabase(label: string) {
    const name = `club_${label}_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
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

  it('migrates an empty PostgreSQL database to the complete schema', async () => {
    const database = await temporaryDatabase('empty');
    try {
      await migrateDatabase(database, resolve('migrations'));
      expect(await tableExists(database, 'users')).toBe(true);
      expect(await tableExists(database, 'snapshot_pages')).toBe(true);
      expect(await tableExists(database, 'claims')).toBe(true);
      expect(await tableExists(database, 'shipments')).toBe(true);
      expect(await tableExists(database, 'announcements')).toBe(true);
      expect(await tableExists(database, 'platform_appearance')).toBe(true);
      expect(await tableExists(database, 'site_pages')).toBe(true);
      expect(await tableExists(database, 'site_page_versions')).toBe(true);
      expect(await tableExists(database, 'site_assets')).toBe(true);
      const migrations = await database.orm.execute<{ value: number }>(
        sql`select count(*)::int as value from drizzle.__drizzle_migrations`,
      );
      expect(migrations[0]?.value).toBe(10);
    } finally {
      await database.close();
    }
  });

  it('upgrades a milestone-6 database without losing existing rows', async () => {
    const database = await temporaryDatabase('upgrade');
    const folder = await mkdtemp(join(tmpdir(), 'club-migrations-'));
    try {
      await mkdir(join(folder, 'meta'), { recursive: true });
      const journal = JSON.parse(
        await readFile(resolve('migrations/meta/_journal.json'), 'utf8'),
      ) as MigrationJournal;
      const legacyJournal: MigrationJournal = {
        ...journal,
        entries: journal.entries.filter((entry) => entry.idx <= 6),
      };
      await writeFile(
        join(folder, 'meta', '_journal.json'),
        `${JSON.stringify(legacyJournal, null, 2)}\n`,
      );
      for (const entry of legacyJournal.entries) {
        await cp(resolve('migrations', `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
      }
      await migrateDatabase(database, folder);
      await database.orm.execute(sql`
        insert into users (name, email)
        values ('Upgrade Survivor', 'upgrade-survivor@example.com')
      `);
      expect(await tableExists(database, 'announcements')).toBe(false);

      await migrateDatabase(database, resolve('migrations'));
      expect(await tableExists(database, 'announcements')).toBe(true);
      expect(await tableExists(database, 'platform_appearance')).toBe(true);
      expect(await tableExists(database, 'site_pages')).toBe(true);
      expect(await tableExists(database, 'site_page_versions')).toBe(true);
      expect(await tableExists(database, 'site_assets')).toBe(true);
      const survivor = await database.orm.execute<{ email: string }>(
        sql`select email from users where email = 'upgrade-survivor@example.com'`,
      );
      expect(survivor[0]?.email).toBe('upgrade-survivor@example.com');
      const migrations = await database.orm.execute<{ value: number }>(
        sql`select count(*)::int as value from drizzle.__drizzle_migrations`,
      );
      expect(migrations[0]?.value).toBe(10);
    } finally {
      await database.close();
      await rm(folder, { force: true, recursive: true });
    }
  });
});
