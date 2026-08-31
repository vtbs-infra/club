import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { EXPECTED_SCHEMA_MIGRATIONS } from '../src/server/infrastructure/db/schema-version.js';

function assertSameFiles(actual: readonly string[], expected: readonly string[], label: string) {
  if (actual.length !== expected.length || actual.some((file, index) => file !== expected[index])) {
    throw new Error(`${label} do not match the Drizzle migration journal.`);
  }
}

export async function assertCheckedInMigrationIdentity(
  workspaceRoot = resolve('.'),
): Promise<void> {
  const migrationsDirectory = resolve(workspaceRoot, 'migrations');
  const metadataDirectory = resolve(migrationsDirectory, 'meta');
  const parsedJournal: unknown = JSON.parse(
    await readFile(resolve(metadataDirectory, '_journal.json'), 'utf8'),
  );
  if (!parsedJournal || typeof parsedJournal !== 'object') {
    throw new Error('The Drizzle migration journal is not a JSON object.');
  }
  const journal = parsedJournal as Record<string, unknown>;
  const journalEntries = journal.entries;
  if (journal.dialect !== 'postgresql' || !Array.isArray(journalEntries)) {
    throw new Error('The Drizzle migration journal is not a PostgreSQL journal.');
  }

  const entries = journalEntries.map((entry: unknown, index) => {
    const migrationIndex = String(index).padStart(4, '0');
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Drizzle migration journal entry ${index} is not an object.`);
    }
    const record = entry as Record<string, unknown>;
    if (
      record.idx !== index ||
      typeof record.tag !== 'string' ||
      !record.tag.startsWith(`${migrationIndex}_`) ||
      typeof record.when !== 'number' ||
      !Number.isSafeInteger(record.when)
    ) {
      throw new Error(`Drizzle migration journal entry ${index} is invalid or out of order.`);
    }
    return { createdAt: String(record.when), index: migrationIndex, tag: record.tag };
  });

  const sqlFiles = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith('.sql'))
    .sort();
  assertSameFiles(
    sqlFiles,
    entries.map((entry) => `${entry.tag}.sql`),
    'Checked-in migration SQL files',
  );

  const snapshotFiles = (await readdir(metadataDirectory))
    .filter((file) => /^\d{4}_snapshot\.json$/.test(file))
    .sort();
  assertSameFiles(
    snapshotFiles,
    entries.map((entry) => `${entry.index}_snapshot.json`),
    'Checked-in Drizzle snapshots',
  );

  const actualIdentity = await Promise.all(
    entries.map(async (entry) => {
      const contents = await readFile(resolve(migrationsDirectory, `${entry.tag}.sql`));
      return {
        createdAt: entry.createdAt,
        hash: createHash('sha256').update(contents).digest('hex'),
        tag: entry.tag,
      };
    }),
  );
  if (
    actualIdentity.length !== EXPECTED_SCHEMA_MIGRATIONS.length ||
    actualIdentity.some((migration, index) => {
      const expected = EXPECTED_SCHEMA_MIGRATIONS[index];
      return (
        migration.createdAt !== expected?.createdAt ||
        migration.hash !== expected.hash ||
        migration.tag !== expected.tag
      );
    })
  ) {
    throw new Error('The application migration identity does not match the checked-in migrations.');
  }
}
