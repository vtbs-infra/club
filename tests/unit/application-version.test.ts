import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  APPLICATION_VERSION,
  readApplicationVersion,
} from '../../src/server/application-version.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function packageFile(metadata: unknown): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'club-version-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'package.json');
  await writeFile(path, JSON.stringify(metadata));
  return path;
}

describe('application version', () => {
  it('uses the root package metadata as the running version', () => {
    expect(readApplicationVersion()).toBe(APPLICATION_VERSION);
  });

  it('accepts stable semantic versions', async () => {
    expect(readApplicationVersion(await packageFile({ version: '12.34.56' }))).toBe('12.34.56');
  });

  it('rejects missing or non-stable versions', async () => {
    const prerelease = await packageFile({ version: '1.0.0-beta.1' });
    const missing = await packageFile({});
    expect(() => readApplicationVersion(prerelease)).toThrow('stable semantic version');
    expect(() => readApplicationVersion(missing)).toThrow('stable semantic version');
  });
});
