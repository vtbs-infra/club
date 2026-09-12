import { appendFile, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { sql } from 'drizzle-orm';
import { migrate as drizzleMigrate } from 'drizzle-orm/postgres-js/migrator';
import { afterEach, expect, it, describe as integration } from 'vitest';

import type { DatabaseService } from '../../src/server/infrastructure/db/database.js';
import { migrateDatabase } from '../../src/server/infrastructure/db/migration-runner.js';
import { EXPECTED_SCHEMA_MIGRATIONS } from '../../src/server/infrastructure/db/schema-version.js';
import {
  createEmptyIntegrationDatabase,
  type IntegrationDatabase,
} from '../helpers/integration-database.js';

integration('database migration baseline', () => {
  let fixture: IntegrationDatabase | undefined;
  const directories: string[] = [];

  afterEach(async () => {
    try {
      await fixture?.cleanup();
    } finally {
      fixture = undefined;
      await Promise.all(
        directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
      );
    }
  });

  async function temporaryDatabase(): Promise<DatabaseService> {
    fixture = await createEmptyIntegrationDatabase('migration');
    return fixture.database;
  }

  async function migrationFolder() {
    const folder = await mkdtemp(join(tmpdir(), 'club-migration-upgrade-'));
    directories.push(folder);
    await cp(resolve('migrations'), folder, { recursive: true });
    return folder;
  }

  async function installPreviousBaseline(database: DatabaseService) {
    const folder = await migrationFolder();
    const journal = JSON.parse(await readFile(join(folder, 'meta/_journal.json'), 'utf8')) as {
      entries: unknown[];
    };
    journal.entries = journal.entries.slice(0, 1);
    await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal));
    // Reproduce the already-deployed baseline with its original Drizzle migration identity.
    await drizzleMigrate(database.orm, { migrationsFolder: folder });
    await database.orm.execute(
      sql`insert into users (username, name, bilibili_uid) values ('retained', 'Retained account', '12345')`,
    );
  }

  async function history(database: DatabaseService) {
    return [
      ...(await database.orm.execute<{ createdAt: string; hash: string }>(sql`
      select created_at::text as "createdAt", hash from drizzle.__drizzle_migrations order by id
    `)),
    ];
  }

  async function tableExists(database: DatabaseService, tableName: string): Promise<boolean> {
    const rows = await database.orm.execute<{ exists: boolean }>(
      sql`select to_regclass(${`public.${tableName}`}) is not null as exists`,
    );
    return Boolean(rows[0]?.exists);
  }

  it('installs on an empty database and does not reapply completed migrations', async () => {
    const database = await temporaryDatabase();
    await migrateDatabase(database);
    await expect(database.checkSchema()).resolves.toBeUndefined();
    const applied = await history(database);
    expect(applied).toHaveLength(EXPECTED_SCHEMA_MIGRATIONS.length);
    await migrateDatabase(database);
    expect(await history(database)).toEqual(applied);
  });

  it('refuses nonempty databases without changing existing data or creating auth tables', async () => {
    const database = await temporaryDatabase();
    await database.orm.execute(sql`create table legacy_accounts (id text primary key)`);
    await database.orm.execute(sql`insert into legacy_accounts values ('preserve-me')`);
    await expect(migrateDatabase(database, resolve('migrations'))).rejects.toThrow(
      'Unrecognized existing databases are not migrated or erased',
    );
    expect(await database.orm.execute(sql`select * from legacy_accounts`)).toEqual([
      { id: 'preserve-me' },
    ]);
    expect(await tableExists(database, 'users')).toBe(false);
    expect(await tableExists(database, 'password_credentials')).toBe(false);
  });

  it('upgrades a recognized baseline in place and remains idempotent', async () => {
    const database = await temporaryDatabase();
    await installPreviousBaseline(database);
    const before = await database.orm.execute(sql`select * from users`);
    await expect(database.checkSchema()).rejects.toThrow('migration identity');
    expect(await tableExists(database, 'identity_challenges_active_expiry_idx')).toBe(false);
    expect(await tableExists(database, 'bilibili_sessions')).toBe(false);
    await migrateDatabase(database);
    await expect(database.checkSchema()).resolves.toBeUndefined();
    expect(await tableExists(database, 'identity_challenges_active_expiry_idx')).toBe(true);
    expect(await tableExists(database, 'bilibili_sessions')).toBe(true);
    expect(await tableExists(database, 'bilibili_login_attempts')).toBe(true);
    expect(await database.orm.execute(sql`select * from users`)).toEqual(before);
    const applied = await history(database);
    expect(applied).toEqual(
      EXPECTED_SCHEMA_MIGRATIONS.map(({ createdAt, hash }) => ({ createdAt, hash })),
    );
    await migrateDatabase(database);
    expect(await history(database)).toEqual(applied);
  });

  it('refuses unknown history before changing data or applying pending SQL', async () => {
    const database = await temporaryDatabase();
    await installPreviousBaseline(database);
    await database.orm.execute(
      sql`update drizzle.__drizzle_migrations set hash = 'modified-baseline'`,
    );
    const before = await history(database);
    const usersBefore = await database.orm.execute(sql`select * from users`);
    await expect(database.checkSchema()).rejects.toThrow('migration identity');
    await expect(migrateDatabase(database)).rejects.toThrow('migration identity');
    expect(await history(database)).toEqual(before);
    expect(await database.orm.execute(sql`select * from users`)).toEqual(usersBefore);
    expect(await tableExists(database, 'bilibili_sessions')).toBe(false);
  });

  it('refuses modified pending SQL before executing it', async () => {
    const database = await temporaryDatabase();
    await installPreviousBaseline(database);
    const folder = await migrationFolder();
    await appendFile(
      join(folder, `${EXPECTED_SCHEMA_MIGRATIONS[1].tag}.sql`),
      '\nDROP TABLE users CASCADE;\n',
    );
    const before = await history(database);
    await expect(migrateDatabase(database, folder)).rejects.toThrow('migration identity');
    expect(await history(database)).toEqual(before);
    expect(await database.orm.execute(sql`select username from users`)).toEqual([
      { username: 'retained' },
    ]);
    expect(await tableExists(database, 'identity_challenges_active_expiry_idx')).toBe(false);
  });

  it('rolls back a failed upgrade without advancing the journal and permits a clean retry', async () => {
    const database = await temporaryDatabase();
    await installPreviousBaseline(database);
    await database.orm.execute(
      sql`create table identity_challenges_active_expiry_idx (marker text)`,
    );
    const before = await history(database);
    await expect(migrateDatabase(database)).rejects.toThrow();
    expect(await history(database)).toEqual(before);
    expect(await database.orm.execute(sql`select username from users`)).toEqual([
      { username: 'retained' },
    ]);
    await database.orm.execute(sql`drop table identity_challenges_active_expiry_idx`);
    await migrateDatabase(database);
    await expect(database.checkSchema()).resolves.toBeUndefined();
  });

  it.each([false, true])(
    'serializes concurrent migration processes, existing baseline=%s',
    async (existing) => {
      const database = await temporaryDatabase();
      if (existing) await installPreviousBaseline(database);
      await Promise.all([migrateDatabase(database), migrateDatabase(database)]);
      await expect(database.checkSchema()).resolves.toBeUndefined();
      expect(await history(database)).toHaveLength(EXPECTED_SCHEMA_MIGRATIONS.length);
    },
  );

  it.each([false, true])(
    'only retries an empty journal when no application data exists, existing data=%s',
    async (existing) => {
      const database = await temporaryDatabase();
      await database.orm.execute(sql`create schema drizzle`);
      await database.orm.execute(
        sql`create table drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`,
      );
      if (existing) {
        await database.orm.execute(sql`create table legacy_accounts (id text primary key)`);
        await database.orm.execute(sql`insert into legacy_accounts values ('preserve-me')`);
        await expect(migrateDatabase(database)).rejects.toThrow('Unrecognized existing databases');
        expect(await history(database)).toEqual([]);
        expect(await tableExists(database, 'users')).toBe(false);
        expect(await database.orm.execute(sql`select * from legacy_accounts`)).toEqual([
          { id: 'preserve-me' },
        ]);
      } else {
        await migrateDatabase(database);
        await expect(database.checkSchema()).resolves.toBeUndefined();
      }
    },
  );
});
