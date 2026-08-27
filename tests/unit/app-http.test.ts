import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildApp } from '../../src/server/app.js';
import { APPLICATION_VERSION } from '../../src/server/application-version.js';
import { InMemoryRateLimiter } from '../../src/server/infrastructure/security/request-security.js';
import { createTemporaryStorage } from '../../src/server/infrastructure/storage/temporary-storage.js';
import { fakeDatabase } from '../helpers/app-stubs.js';
import { createTestConfig } from '../helpers/test-config.js';

interface ErrorResponse {
  readonly error: { readonly code: string };
}

interface OpenApiDocument {
  readonly info: { readonly version: string };
  readonly paths: Record<string, unknown>;
}

describe('application HTTP shell', () => {
  it('generates OpenAPI from route schemas', async () => {
    const storage = await createTemporaryStorage();
    const app = await buildApp({
      config: createTestConfig(),
      database: fakeDatabase(),
      storage: storage.driver,
    });
    try {
      const response = await app.inject({ method: 'GET', url: '/openapi.json' });
      expect(response.statusCode).toBe(200);
      expect(response.json<OpenApiDocument>().info.version).toBe(APPLICATION_VERSION);
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
      await app.close();
      await storage.cleanup();
    }
  });

  it('serves SPA navigation without swallowing API or private storage routes', async () => {
    const storage = await createTemporaryStorage();
    const webRoot = join(storage.root, 'web');
    await mkdir(join(webRoot, 'assets'), { recursive: true });
    await writeFile(join(webRoot, 'index.html'), '<main>Club shell</main>');
    const app = await buildApp({
      config: createTestConfig({ nodeEnv: 'production' }),
      database: fakeDatabase(),
      serveStatic: true,
      storage: storage.driver,
      webRoot,
    });
    try {
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
      await app.close();
      await storage.cleanup();
    }
  });

  it('rate-limits state-changing API requests after origin validation', async () => {
    const storage = await createTemporaryStorage();
    const app = await buildApp({
      config: createTestConfig(),
      database: fakeDatabase(),
      rateLimiter: new InMemoryRateLimiter(1, 60_000),
      storage: storage.driver,
    });
    try {
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
      await app.close();
      await storage.cleanup();
    }
  });
});
