import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/server/app.js';
import type { DatabaseService } from '../../src/server/infrastructure/db/database.js';
import { createTemporaryStorage } from '../../src/server/infrastructure/storage/temporary-storage.js';
import type { ReadinessResponse } from '../../src/shared/contracts/health.js';
import { createTestConfig } from '../helpers/test-config.js';

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
    orm: {} as PostgresJsDatabase,
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
    } finally {
      await storage.cleanup();
    }
  });
});
