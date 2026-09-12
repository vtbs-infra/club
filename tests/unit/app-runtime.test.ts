import { describe, expect, it, vi } from 'vitest';

import { buildTestApp } from '../helpers/test-app.js';
import { createTemporaryStorage } from '../../src/server/infrastructure/storage/temporary-storage.js';
import type { ReadinessResponse } from '../../src/shared/contracts/health.js';
import { runtimeStub, fakeDatabase, runtimeStatus } from '../helpers/app-stubs.js';
import { createTestConfig } from '../helpers/test-config.js';

describe('application runtime lifecycle', () => {
  it('closes every background runtime during graceful application shutdown', async () => {
    const storage = await createTemporaryStorage();
    const identityClose = vi.fn(() => Promise.resolve());
    const snapshotClose = vi.fn();
    const giftMediaClose = vi.fn();
    const databaseClose = vi.fn(() => Promise.resolve());
    const database = fakeDatabase();
    const app = await buildTestApp({
      identityRuntime: runtimeStub({ close: identityClose }),
      config: createTestConfig(),
      database: { ...database, close: databaseClose },
      giftMediaRuntime: runtimeStub({ close: giftMediaClose }),
      snapshotRuntime: runtimeStub({ close: snapshotClose }),
      startBackground: false,
      storage: storage.driver,
    });

    await app.close();
    expect(identityClose).toHaveBeenCalledOnce();
    expect(snapshotClose).toHaveBeenCalledOnce();
    expect(giftMediaClose).toHaveBeenCalledOnce();
    expect(databaseClose).not.toHaveBeenCalled();
    await storage.cleanup();
  });

  it('starts runtimes independently and reports a degraded runtime as not ready', async () => {
    const storage = await createTemporaryStorage();
    const identityStart = vi.fn(() => Promise.reject(new Error('identity startup failed')));
    const snapshotStart = vi.fn(() => Promise.resolve());
    const giftMediaStart = vi.fn(() => Promise.resolve());
    const app = await buildTestApp({
      identityRuntime: runtimeStub({
        getStatus: () => runtimeStatus('DEGRADED'),
        start: identityStart,
      }),
      config: createTestConfig(),
      database: fakeDatabase(),
      giftMediaRuntime: runtimeStub({
        getStatus: () => runtimeStatus('RUNNING'),
        start: giftMediaStart,
      }),
      snapshotRuntime: runtimeStub({
        getStatus: () => runtimeStatus('RUNNING'),
        start: snapshotStart,
      }),
      startBackground: true,
      storage: storage.driver,
    });
    try {
      await app.ready();
      expect(identityStart).toHaveBeenCalledOnce();
      expect(snapshotStart).toHaveBeenCalledOnce();
      expect(giftMediaStart).toHaveBeenCalledOnce();
      const ready = await app.inject({ method: 'GET', url: '/health/ready' });
      expect(ready.statusCode).toBe(503);
      expect(ready.json<ReadinessResponse>().checks.runtimes).toBe('down');
    } finally {
      await app.close();
      await storage.cleanup();
    }
  });
});
