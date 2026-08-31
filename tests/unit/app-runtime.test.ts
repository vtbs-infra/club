import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/server/app.js';
import { createTemporaryStorage } from '../../src/server/infrastructure/storage/temporary-storage.js';
import type { ReadinessResponse } from '../../src/shared/contracts/health.js';
import {
  bindingRuntimeStub,
  fakeDatabase,
  fulfillmentRuntimeStub,
  giftMediaRuntimeStub,
  runtimeStatus,
  snapshotRuntimeStub,
} from '../helpers/app-stubs.js';
import { createTestConfig } from '../helpers/test-config.js';

describe('application runtime lifecycle', () => {
  it('closes every background runtime during graceful application shutdown', async () => {
    const storage = await createTemporaryStorage();
    const bindingClose = vi.fn(() => Promise.resolve());
    const snapshotClose = vi.fn();
    const fulfillmentClose = vi.fn();
    const giftMediaClose = vi.fn();
    const databaseClose = vi.fn(() => Promise.resolve());
    const database = fakeDatabase();
    const app = await buildApp({
      bindingRuntime: bindingRuntimeStub({ close: bindingClose }),
      config: createTestConfig(),
      database: { ...database, close: databaseClose },
      fulfillmentRuntime: fulfillmentRuntimeStub({ close: fulfillmentClose }),
      giftMediaRuntime: giftMediaRuntimeStub({ close: giftMediaClose }),
      snapshotRuntime: snapshotRuntimeStub({ close: snapshotClose }),
      startBackground: false,
      storage: storage.driver,
    });

    await app.close();
    expect(bindingClose).toHaveBeenCalledOnce();
    expect(snapshotClose).toHaveBeenCalledOnce();
    expect(fulfillmentClose).toHaveBeenCalledOnce();
    expect(giftMediaClose).toHaveBeenCalledOnce();
    expect(databaseClose).not.toHaveBeenCalled();
    await storage.cleanup();
  });

  it('starts runtimes independently and reports a degraded runtime as not ready', async () => {
    const storage = await createTemporaryStorage();
    const bindingStart = vi.fn(() => Promise.reject(new Error('binding startup failed')));
    const snapshotStart = vi.fn(() => Promise.resolve());
    const fulfillmentStart = vi.fn(() => Promise.resolve());
    const giftMediaStart = vi.fn(() => Promise.resolve());
    const app = await buildApp({
      bindingRuntime: bindingRuntimeStub({
        getStatus: () => runtimeStatus('DEGRADED'),
        start: bindingStart,
      }),
      config: createTestConfig(),
      database: fakeDatabase(),
      fulfillmentRuntime: fulfillmentRuntimeStub({
        getStatus: () => ({ ...runtimeStatus('RUNNING'), configured: false }),
        start: fulfillmentStart,
      }),
      giftMediaRuntime: giftMediaRuntimeStub({
        getStatus: () => runtimeStatus('RUNNING'),
        start: giftMediaStart,
      }),
      snapshotRuntime: snapshotRuntimeStub({
        getStatus: () => runtimeStatus('RUNNING'),
        start: snapshotStart,
      }),
      startBackground: true,
      storage: storage.driver,
    });
    try {
      await app.ready();
      expect(bindingStart).toHaveBeenCalledOnce();
      expect(snapshotStart).toHaveBeenCalledOnce();
      expect(fulfillmentStart).toHaveBeenCalledOnce();
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
