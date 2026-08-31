import { appendFile, cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { assertCheckedInMigrationIdentity } from '../../scripts/migration-identity.js';

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
  it('matches the complete checked-in migration set and journal', async () => {
    await expect(assertCheckedInMigrationIdentity()).resolves.toBeUndefined();
  });

  it('rejects an unjournaled migration file', async () => {
    const workspace = await migrationWorkspace();
    await writeFile(join(workspace, 'migrations', '0001_unjournaled.sql'), 'select 1;\n');
    await expect(assertCheckedInMigrationIdentity(workspace)).rejects.toThrow(
      'migration SQL files do not match',
    );
  });

  it('rejects migration contents that differ from the application identity', async () => {
    const workspace = await migrationWorkspace();
    await appendFile(join(workspace, 'migrations', '0000_v0_2_baseline.sql'), '\n-- changed\n');
    await expect(assertCheckedInMigrationIdentity(workspace)).rejects.toThrow(
      'application migration identity does not match',
    );
  });
});
