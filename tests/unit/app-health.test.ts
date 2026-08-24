import { describe, expect, it } from 'vitest';

import { buildApp } from '../../src/server/app.js';
import { createTemporaryStorage } from '../../src/server/infrastructure/storage/temporary-storage.js';
import type { ReadinessResponse } from '../../src/shared/contracts/health.js';
import { fakeDatabase } from '../helpers/app-stubs.js';
import { createTestConfig } from '../helpers/test-config.js';

describe('application health', () => {
  it('keeps liveness independent from PostgreSQL and exposes request IDs', async () => {
    const storage = await createTemporaryStorage();
    const app = await buildApp({
      config: createTestConfig(),
      database: fakeDatabase(() => Promise.reject(new Error('database unavailable'))),
      storage: storage.driver,
    });
    try {
      const live = await app.inject({ method: 'GET', url: '/health/live' });
      expect(live.statusCode).toBe(200);
      expect(live.json()).toMatchObject({ status: 'ok', version: '0.1.0' });
      expect(live.headers['x-request-id']).toBeTypeOf('string');
      expect(live.headers['x-content-type-options']).toBe('nosniff');
      expect(live.headers['x-frame-options']).toBe('DENY');
      expect(live.headers['referrer-policy']).toBe('no-referrer');
      expect(live.headers['content-security-policy']).toContain("default-src 'self'");
      expect(live.headers['cache-control']).toBe('no-store');

      const ready = await app.inject({ method: 'GET', url: '/health/ready' });
      expect(ready.statusCode).toBe(503);
      expect(ready.json()).toEqual({
        checks: {
          database: 'down',
          runtimes: 'disabled',
          schema: 'down',
          storage: 'ok',
        },
        status: 'not_ready',
      });
    } finally {
      await app.close();
      await storage.cleanup();
    }
  });

  it('reports ready when PostgreSQL and storage respond', async () => {
    const storage = await createTemporaryStorage();
    const app = await buildApp({
      config: createTestConfig(),
      database: fakeDatabase(),
      storage: storage.driver,
    });
    try {
      const response = await app.inject({ method: 'GET', url: '/health/ready' });
      expect(response.statusCode).toBe(200);
      expect(response.json<ReadinessResponse>().status).toBe('ok');
    } finally {
      await app.close();
      await storage.cleanup();
    }
  });

  it('rejects readiness when PostgreSQL is reachable but migrations are incomplete', async () => {
    const storage = await createTemporaryStorage();
    const app = await buildApp({
      config: createTestConfig(),
      database: fakeDatabase(
        () => Promise.resolve(),
        () => Promise.reject(new Error('schema incomplete')),
      ),
      storage: storage.driver,
    });
    try {
      const response = await app.inject({ method: 'GET', url: '/health/ready' });
      expect(response.statusCode).toBe(503);
      expect(response.json<ReadinessResponse>()).toMatchObject({
        checks: { database: 'ok', schema: 'down' },
        status: 'not_ready',
      });
    } finally {
      await app.close();
      await storage.cleanup();
    }
  });
});
