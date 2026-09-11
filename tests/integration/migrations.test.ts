import { appendFile, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { sql } from 'drizzle-orm';
import { migrate as drizzleMigrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it, describe as integration } from 'vitest';

import {
  createDatabase,
  type DatabaseService,
} from '../../src/server/infrastructure/db/database.js';
import { migrateDatabase } from '../../src/server/infrastructure/db/migration-runner.js';
import { EXPECTED_SCHEMA_MIGRATIONS } from '../../src/server/infrastructure/db/schema-version.js';
import { integrationDatabaseUrl } from '../helpers/integration-database.js';

integration('database migration baseline', () => {
  let admin: ReturnType<typeof postgres>;
  const databases: string[] = [];
  const directories: string[] = [];

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
    for (const directory of directories) await rm(directory, { force: true, recursive: true });
  });

  async function temporaryDatabase(): Promise<DatabaseService> {
    const name = `club_baseline_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
    await admin.unsafe(`create database "${name}"`);
    databases.push(name);
    const targetUrl = new URL(integrationDatabaseUrl());
    targetUrl.pathname = `/${name}`;
    return createDatabase(targetUrl.toString());
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
      expect(migrations[0]?.value).toBe(EXPECTED_SCHEMA_MIGRATIONS.length);
      await expect(database.checkSchema()).resolves.toBeUndefined();
      await expect(migrateDatabase(database, resolve('migrations'))).resolves.toBeUndefined();
      expect(
        await database.orm.execute(
          sql`select count(*)::int as value from drizzle.__drizzle_migrations`,
        ),
      ).toEqual([{ value: EXPECTED_SCHEMA_MIGRATIONS.length }]);

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
        'Unrecognized existing databases are not migrated or erased',
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

  it('upgrades a recognized baseline in place and remains idempotent', async () => {
    const database = await temporaryDatabase();
    try {
      await installPreviousBaseline(database);
      const before = await database.orm.execute(sql`select * from users`);
      await expect(database.checkSchema()).rejects.toThrow('migration identity');
      expect(await tableExists(database, 'identity_challenges_active_expiry_idx')).toBe(false);
      await migrateDatabase(database);
      await expect(database.checkSchema()).resolves.toBeUndefined();
      expect(await tableExists(database, 'identity_challenges_active_expiry_idx')).toBe(true);
      expect(await database.orm.execute(sql`select * from users`)).toEqual(before);
      const applied = await history(database);
      expect(applied).toEqual(
        EXPECTED_SCHEMA_MIGRATIONS.map(({ createdAt, hash }) => ({ createdAt, hash })),
      );
      await migrateDatabase(database);
      expect(await history(database)).toEqual(applied);
    } finally {
      await database.close();
    }
  });

  it.each(['hash', 'timestamp', 'gap', 'reordered', 'duplicate', 'future'] as const)(
    'refuses a %s mismatch before applying pending SQL or changing data',
    async (mismatch) => {
      const database = await temporaryDatabase();
      try {
        await installPreviousBaseline(database);
        if (mismatch === 'hash')
          await database.orm.execute(
            sql`update drizzle.__drizzle_migrations set hash = 'legacy-or-modified-baseline'`,
          );
        if (mismatch === 'timestamp')
          await database.orm.execute(
            sql`update drizzle.__drizzle_migrations set created_at = created_at + 1`,
          );
        if (mismatch === 'gap' || mismatch === 'reordered') {
          await database.orm.execute(sql`delete from drizzle.__drizzle_migrations`);
          const second = EXPECTED_SCHEMA_MIGRATIONS[1];
          await database.orm.execute(
            sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${second.hash}, ${second.createdAt})`,
          );
        }
        if (mismatch === 'duplicate' || mismatch === 'reordered') {
          const first = EXPECTED_SCHEMA_MIGRATIONS[0];
          await database.orm.execute(
            sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${first.hash}, ${first.createdAt})`,
          );
        }
        if (mismatch === 'future')
          await database.orm.execute(
            sql`insert into drizzle.__drizzle_migrations (hash, created_at) values ('newer-application', 9999999999999)`,
          );
        const before = await history(database);
        const usersBefore = await database.orm.execute(sql`select * from users`);
        await expect(migrateDatabase(database)).rejects.toThrow('migration identity');
        expect(await history(database)).toEqual(before);
        expect(await database.orm.execute(sql`select * from users`)).toEqual(usersBefore);
        expect(await tableExists(database, 'identity_challenges_active_expiry_idx')).toBe(false);
      } finally {
        await database.close();
      }
    },
  );

  it('refuses modified pending SQL before executing it', async () => {
    const database = await temporaryDatabase();
    try {
      await installPreviousBaseline(database);
      const folder = await migrationFolder();
      await appendFile(
        join(folder, '0001_identity_challenge_capacity.sql'),
        '\nDROP TABLE users CASCADE;\n',
      );
      const before = await history(database);
      await expect(migrateDatabase(database, folder)).rejects.toThrow('migration identity');
      expect(await history(database)).toEqual(before);
      expect(await database.orm.execute(sql`select username from users`)).toEqual([
        { username: 'retained' },
      ]);
      expect(await tableExists(database, 'identity_challenges_active_expiry_idx')).toBe(false);
    } finally {
      await database.close();
    }
  });

  it('rolls back a failed upgrade without advancing the journal and permits a clean retry', async () => {
    const database = await temporaryDatabase();
    try {
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
    } finally {
      await database.close();
    }
  });

  it.each([false, true])(
    'serializes concurrent migration processes, existing baseline=%s',
    async (existing) => {
      const database = await temporaryDatabase();
      try {
        if (existing) await installPreviousBaseline(database);
        await Promise.all([migrateDatabase(database), migrateDatabase(database)]);
        await expect(database.checkSchema()).resolves.toBeUndefined();
        expect(await history(database)).toHaveLength(EXPECTED_SCHEMA_MIGRATIONS.length);
      } finally {
        await database.close();
      }
    },
  );

  it.each([false, true])(
    'only retries an empty journal when no application data exists, existing data=%s',
    async (existing) => {
      const database = await temporaryDatabase();
      try {
        await database.orm.execute(sql`create schema drizzle`);
        await database.orm.execute(
          sql`create table drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`,
        );
        if (existing) {
          await database.orm.execute(sql`create table legacy_accounts (id text primary key)`);
          await database.orm.execute(sql`insert into legacy_accounts values ('preserve-me')`);
          await expect(migrateDatabase(database)).rejects.toThrow(
            'Unrecognized existing databases',
          );
          expect(await history(database)).toEqual([]);
          expect(await tableExists(database, 'users')).toBe(false);
          expect(await database.orm.execute(sql`select * from legacy_accounts`)).toEqual([
            { id: 'preserve-me' },
          ]);
        } else {
          await migrateDatabase(database);
          await expect(database.checkSchema()).resolves.toBeUndefined();
        }
      } finally {
        await database.close();
      }
    },
  );
});
