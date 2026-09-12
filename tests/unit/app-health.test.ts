import { describe, expect, it } from 'vitest';
import { buildHttpApp } from '../../src/server/http-app.js';
import readinessRoutes, {
  type ReadinessOptions,
} from '../../src/server/infrastructure/http/readiness-routes.js';
import type { ReadinessResponse } from '../../src/shared/contracts/health.js';

async function healthApp(database: ReadinessOptions['database']) {
  const app = await buildHttpApp({
    config: { logLevel: 'silent', nodeEnv: 'test', trustProxy: false },
  });
  await app.register(readinessRoutes, {
    database,
    storage: { checkHealth: () => Promise.resolve() },
    runtimes: [],
    backgroundRequired: false,
  });
  return app;
}

describe('application health', () => {
  it('keeps liveness independent from unavailable dependencies', async () => {
    const unavailable = () => Promise.reject(new Error('database unavailable'));
    const app = await healthApp({ ping: unavailable, checkSchema: unavailable });
    try {
      const live = await app.inject({ method: 'GET', url: '/health/live' });
      expect(live.statusCode).toBe(200);
      expect(live.headers['x-request-id']).toBeTypeOf('string');
      const ready = await app.inject({ method: 'GET', url: '/health/ready' });
      expect(ready.statusCode).toBe(503);
      expect(ready.json<ReadinessResponse>()).toMatchObject({
        checks: { database: 'down', schema: 'down' },
        status: 'not_ready',
      });
    } finally {
      await app.close();
    }
  });

  it('requires the application schema even when PostgreSQL is reachable', async () => {
    const app = await healthApp({
      ping: () => Promise.resolve(),
      checkSchema: () => Promise.reject(new Error('schema incomplete')),
    });
    try {
      const ready = await app.inject({ method: 'GET', url: '/health/ready' });
      expect(ready.statusCode).toBe(503);
      expect(ready.json<ReadinessResponse>()).toMatchObject({
        checks: { database: 'ok', schema: 'down' },
        status: 'not_ready',
      });
    } finally {
      await app.close();
    }
  });
});
