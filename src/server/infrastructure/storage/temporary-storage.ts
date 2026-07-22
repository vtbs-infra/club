import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalStorageDriver } from './local-storage.js';

export interface TemporaryStorage {
  readonly driver: LocalStorageDriver;
  readonly root: string;
  cleanup(): Promise<void>;
}

export async function createTemporaryStorage(): Promise<TemporaryStorage> {
  const root = await mkdtemp(join(tmpdir(), 'club-storage-'));
  return {
    driver: new LocalStorageDriver(root),
    root,
    async cleanup() {
      await rm(root, { force: true, recursive: true });
    },
  };
}
