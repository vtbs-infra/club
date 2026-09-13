import { appendFile, cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { EXPECTED_SCHEMA_MIGRATIONS } from '../../src/server/infrastructure/db/schema-version.js';
import { assertMigrationHistory } from '../../src/server/infrastructure/db/migration-history.js';
import { assertCheckedInMigrationIdentity } from '../../scripts/check-migrations.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function migrationWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'club-migrations-'));
  temporaryDirectories.push(directory);
  await cp(resolve('migrations'), join(directory, 'migrations'), { recursive: true });
  return directory;
}

describe('database schema version', () => {
  it('rejects an unjournaled migration file', async () => {
    const workspace = await migrationWorkspace();
    await writeFile(join(workspace, 'migrations', '0001_unjournaled.sql'), 'select 1;\n');
    await expect(assertCheckedInMigrationIdentity(workspace)).rejects.toThrow(
      'migration SQL files do not match',
    );
  });

  it('rejects migration contents that differ from the application identity', async () => {
    const workspace = await migrationWorkspace();
    await appendFile(
      join(workspace, 'migrations', `${EXPECTED_SCHEMA_MIGRATIONS[0].tag}.sql`),
      '\n-- changed\n',
    );
    await expect(assertCheckedInMigrationIdentity(workspace)).rejects.toThrow(
      'application migration identity does not match',
    );
  });
});

describe('migration history admission', () => {
  const expected = EXPECTED_SCHEMA_MIGRATIONS;
  it('accepts a prefix for deployment while readiness requires all migrations', () => {
    const prefix = expected.slice(0, -1);
    expect(() => assertMigrationHistory(prefix, { allowPrefix: true })).not.toThrow();
    expect(() => assertMigrationHistory(prefix)).toThrow('migration identity');
    expect(() => assertMigrationHistory(expected)).not.toThrow();
  });
  it.each([
    ['absent journal', null],
    ['changed hash', [{ ...expected[0], hash: 'modified' }]],
    ['changed timestamp', [{ ...expected[0], createdAt: '1' }]],
    ['gap', expected.slice(1)],
    ['reordered', [...expected].reverse()],
    ['duplicate', [expected[0], expected[0]]],
    ['future migration', [...expected, { hash: 'future', createdAt: '9999999999999' }]],
  ] as const)('rejects %s even during deployment', (_label, applied) => {
    expect(() => assertMigrationHistory(applied, { allowPrefix: true })).toThrow(
      'migration identity',
    );
  });
});
