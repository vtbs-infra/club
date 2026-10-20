import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';
import { buildHttpApp } from '../../src/server/http-app.js';
import readinessRoutes, {
  type ReadinessOptions,
} from '../../src/server/infrastructure/http/readiness-routes.js';
import type { ReadinessResponse } from '../../src/shared/contracts/health.js';

function captureLogs() {
  const capture = {
    output: '',
    stream: new Writable({
      write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void) {
        capture.output += chunk.toString('utf8');
        callback();
      },
    }),
  };
  return capture;
}

async function healthApp(
  database: ReadinessOptions['database'],
  logging: { level: 'error' | 'info' | 'silent'; stream?: Writable } = { level: 'silent' },
) {
  const app = await buildHttpApp({
    config: { logLevel: logging.level, nodeEnv: 'test', trustProxy: false },
    ...(logging.stream ? { loggerStream: logging.stream } : {}),
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

  it('logs failed readiness checks without logging routine probes', async () => {
    const logs = captureLogs();
    let databaseAvailable = true;
    const app = await healthApp(
      {
        ping: () =>
          databaseAvailable ? Promise.resolve() : Promise.reject(new Error('database unavailable')),
        checkSchema: () => Promise.resolve(),
      },
      { level: 'info', stream: logs.stream },
    );
    try {
      expect((await app.inject({ method: 'GET', url: '/health/live' })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/health/ready?probe=1' })).statusCode).toBe(
        200,
      );
      expect(logs.output).toBe('');

      databaseAvailable = false;
      expect((await app.inject({ method: 'GET', url: '/health/ready' })).statusCode).toBe(503);
      const entries = logs.output
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { checks?: unknown; level: number; msg: string });
      expect(entries.map(({ checks, level, msg }) => ({ checks, level, msg }))).toEqual([
        {
          checks: { database: 'down', runtimes: 'disabled', schema: 'ok', storage: 'ok' },
          level: 40,
          msg: 'readiness check failed',
        },
      ]);

      logs.output = '';
      await app.inject({ method: 'GET', url: '/api/v1/unknown' });
      expect(logs.output).toContain('"msg":"request completed"');
    } finally {
      await app.close();
    }
  });

  it('keeps readiness warnings below a stricter configured log level', async () => {
    const logs = captureLogs();
    const unavailable = () => Promise.reject(new Error('database unavailable'));
    const app = await healthApp(
      { ping: unavailable, checkSchema: unavailable },
      { level: 'error', stream: logs.stream },
    );
    try {
      expect((await app.inject({ method: 'GET', url: '/health/ready' })).statusCode).toBe(503);
      expect(logs.output).toBe('');
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
