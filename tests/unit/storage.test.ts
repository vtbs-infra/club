import { describe, expect, it } from 'vitest';

import { InvalidStorageKeyError } from '../../src/server/infrastructure/storage/local-storage.js';
import { createTemporaryStorage } from '../../src/server/infrastructure/storage/temporary-storage.js';

describe('LocalStorageDriver', () => {
  it('writes, replaces, opens, and deletes private objects', async () => {
    const temporary = await createTemporaryStorage();
    try {
      const first = await temporary.driver.put({
        data: 'first',
        key: 'private/snapshots/run/page-1.json.gz',
      });
      expect(first.size).toBe(5);

      await temporary.driver.put({
        data: 'second',
        key: 'private/snapshots/run/page-1.json.gz',
      });
      const body = await new Response(
        await temporary.driver.open('private/snapshots/run/page-1.json.gz'),
      ).text();
      expect(body).toBe('second');

      await temporary.driver.delete('private/snapshots/run/page-1.json.gz');
      await expect(
        temporary.driver
          .open('private/snapshots/run/page-1.json.gz')
          .then((stream) => new Response(stream).text()),
      ).rejects.toThrow();
    } finally {
      await temporary.cleanup();
    }
  });

  it('rejects traversal and absolute keys', async () => {
    const temporary = await createTemporaryStorage();
    try {
      await expect(temporary.driver.put({ data: 'x', key: '../escape' })).rejects.toThrow(
        InvalidStorageKeyError,
      );
      await expect(temporary.driver.put({ data: 'x', key: 'C:\\escape' })).rejects.toThrow(
        InvalidStorageKeyError,
      );
    } finally {
      await temporary.cleanup();
    }
  });

  it('performs an isolated health write', async () => {
    const temporary = await createTemporaryStorage();
    try {
      await expect(temporary.driver.checkHealth()).resolves.toBeUndefined();
    } finally {
      await temporary.cleanup();
    }
  });

  it('removes stale atomic-write objects without touching completed evidence', async () => {
    const temporary = await createTemporaryStorage();
    try {
      await temporary.driver.put({ data: 'orphan', key: 'private/snapshots/.orphan.tmp' });
      await temporary.driver.put({ data: 'evidence', key: 'private/snapshots/page-1.json.gz' });
      expect(
        await temporary.driver.cleanupStaleTemporaryObjects(new Date(Date.now() + 1_000)),
      ).toBe(1);
      await expect(temporary.driver.open('private/snapshots/.orphan.tmp')).rejects.toThrow();
      await expect(
        temporary.driver.open('private/snapshots/page-1.json.gz'),
      ).resolves.toBeDefined();
    } finally {
      await temporary.cleanup();
    }
  });
});
