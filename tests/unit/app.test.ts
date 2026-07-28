import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/server/app.js';
import type { AppDatabase, DatabaseService } from '../../src/server/infrastructure/db/database.js';
import { createTemporaryStorage } from '../../src/server/infrastructure/storage/temporary-storage.js';
import type { ReadinessResponse } from '../../src/shared/contracts/health.js';
import { createTestConfig } from '../helpers/test-config.js';
import { InMemoryRateLimiter } from '../../src/server/infrastructure/security/request-security.js';
import type { BindingRuntime } from '../../src/server/modules/binding/binding-runtime.js';
import type { FulfillmentRuntime } from '../../src/server/modules/fulfillment/fulfillment-runtime.js';
import type { SnapshotRuntime } from '../../src/server/modules/snapshots/snapshot-runtime.js';

interface ErrorResponse {
  readonly error: { readonly code: string };
}

interface OpenApiDocument {
  readonly paths: Record<string, unknown>;
}

const openApps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => app.close()));
});

function fakeDatabase(ping: () => Promise<void>): DatabaseService {
  return {
    close: vi.fn(() => Promise.resolve()),
    orm: {} as AppDatabase,
    ping,
  };
}

describe('application factory', () => {
  it('keeps liveness independent from PostgreSQL and exposes request IDs', async () => {
    const storage = await createTemporaryStorage();
    try {
      const app = await buildApp({
        config: createTestConfig(),
        database: fakeDatabase(() => Promise.reject(new Error('database unavailable'))),
        storage: storage.driver,
      });
      openApps.push(app);

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
        checks: { database: 'down', storage: 'ok' },
        status: 'not_ready',
      });
    } finally {
      await storage.cleanup();
    }
  });

  it('reports ready when PostgreSQL and storage respond', async () => {
    const storage = await createTemporaryStorage();
    try {
      const app = await buildApp({
        config: createTestConfig(),
        database: fakeDatabase(() => Promise.resolve()),
        storage: storage.driver,
      });
      openApps.push(app);
      const response = await app.inject({ method: 'GET', url: '/health/ready' });
      expect(response.statusCode).toBe(200);
      expect(response.json<ReadinessResponse>().status).toBe('ok');
    } finally {
      await storage.cleanup();
    }
  });

  it('generates OpenAPI from route schemas', async () => {
    const storage = await createTemporaryStorage();
    try {
      const app = await buildApp({
        config: createTestConfig(),
        database: fakeDatabase(() => Promise.resolve()),
        storage: storage.driver,
      });
      openApps.push(app);
      const response = await app.inject({ method: 'GET', url: '/openapi.json' });
      expect(response.statusCode).toBe(200);
      expect(response.json<OpenApiDocument>().paths).toHaveProperty('/health/live');
      expect(response.json<OpenApiDocument>().paths).toHaveProperty('/health/ready');
      expect(response.json<OpenApiDocument>().paths).toHaveProperty('/api/v1/me');
      expect(response.json<OpenApiDocument>().paths).toHaveProperty('/api/v1/me/addresses');
      expect(response.json<OpenApiDocument>().paths).toHaveProperty('/api/v1/me/gifts');
      expect(response.json<OpenApiDocument>().paths).toHaveProperty('/api/v1/creator/releases');
      expect(response.json<OpenApiDocument>().paths).toHaveProperty('/api/v1/creator/orders');
      expect(response.json<OpenApiDocument>().paths).toHaveProperty('/api/v1/admin/creators');
      expect(response.json<OpenApiDocument>().paths).toHaveProperty('/api/v1/admin/rosters');
      expect(response.json<OpenApiDocument>().paths).toHaveProperty(
        '/api/v1/admin/verification-rooms',
      );
    } finally {
      await storage.cleanup();
    }
  });

  it('serves SPA navigation without swallowing API routes', async () => {
    const storage = await createTemporaryStorage();
    const webRoot = join(storage.root, 'web');
    await mkdir(join(webRoot, 'assets'), { recursive: true });
    await writeFile(join(webRoot, 'index.html'), '<main>Club shell</main>');
    try {
      const app = await buildApp({
        config: createTestConfig({ nodeEnv: 'production' }),
        database: fakeDatabase(() => Promise.resolve()),
        serveStatic: true,
        storage: storage.driver,
        webRoot,
      });
      openApps.push(app);

      const navigation = await app.inject({
        headers: { accept: 'text/html' },
        method: 'GET',
        url: '/future/recipient-route',
      });
      expect(navigation.statusCode).toBe(200);
      expect(navigation.body).toContain('Club shell');

      const api = await app.inject({
        headers: { accept: 'text/html' },
        method: 'GET',
        url: '/api/v1/missing',
      });
      expect(api.statusCode).toBe(404);
      expect(api.json<ErrorResponse>().error.code).toBe('NOT_FOUND');
      expect(api.headers['strict-transport-security']).toContain('max-age=31536000');

      const privateStorage = await app.inject({
        method: 'GET',
        url: '/data/club/private/snapshots/page-1.json.gz',
      });
      expect(privateStorage.statusCode).toBe(404);
      const traversal = await app.inject({
        method: 'GET',
        url: '/assets/%2e%2e/%2e%2e/data/club/private/snapshots/page-1.json.gz',
      });
      expect(traversal.statusCode).toBe(404);
    } finally {
      await storage.cleanup();
    }
  });

  it('rate-limits state-changing API requests after origin validation', async () => {
    const storage = await createTemporaryStorage();
    try {
      const app = await buildApp({
        config: createTestConfig(),
        database: fakeDatabase(() => Promise.resolve()),
        rateLimiter: new InMemoryRateLimiter(1, 60_000),
        storage: storage.driver,
      });
      openApps.push(app);
      const request = () =>
        app.inject({
          headers: { origin: 'http://localhost:3000' },
          method: 'POST',
          payload: {},
          url: '/api/v1/missing',
        });
      expect((await request()).statusCode).toBe(404);
      const limited = await request();
      expect(limited.statusCode).toBe(429);
      expect(limited.json<ErrorResponse>().error.code).toBe('RATE_LIMITED');
      expect(limited.headers['retry-after']).toBeDefined();
    } finally {
      await storage.cleanup();
    }
  });

  it('closes every background runtime during graceful application shutdown', async () => {
    const storage = await createTemporaryStorage();
    const bindingClose = vi.fn(() => Promise.resolve());
    const snapshotClose = vi.fn();
    const fulfillmentClose = vi.fn();
    const databaseClose = vi.fn(() => Promise.resolve());
    const database = fakeDatabase(() => Promise.resolve());
    const app = await buildApp({
      bindingRuntime: {
        bindings: {},
        close: bindingClose,
        connections: {},
        rooms: {},
        source: {},
        start: () => Promise.resolve(),
      } as unknown as BindingRuntime,
      config: createTestConfig(),
      database: { ...database, close: databaseClose },
      fulfillmentRuntime: {
        close: fulfillmentClose,
        getStatus: () => ({ configured: false, lastTickAt: null, running: false }),
        provider: null,
        service: {},
        start: () => Promise.resolve(),
        tick: () => Promise.resolve(),
      } as unknown as FulfillmentRuntime,
      snapshotRuntime: {
        close: snapshotClose,
        getStatus: () => ({ lastTickAt: null, running: false }),
        service: {},
        source: {},
        start: () => Promise.resolve(),
        tick: () => Promise.resolve(),
      } as unknown as SnapshotRuntime,
      startBackground: false,
      storage: storage.driver,
    });
    await app.close();
    expect(bindingClose).toHaveBeenCalledOnce();
    expect(snapshotClose).toHaveBeenCalledOnce();
    expect(fulfillmentClose).toHaveBeenCalledOnce();
    expect(databaseClose).not.toHaveBeenCalled();
    await storage.cleanup();
  });
});
