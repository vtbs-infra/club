import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import { Type } from '@sinclair/typebox';
import Fastify, { LogController, type FastifyError } from 'fastify';
import pino, { type DestinationStream } from 'pino';

import { AppError } from '../shared/errors/app-error.js';
import { loadConfig, type AppConfig } from './config/env.js';
import { SystemClock, type Clock } from './infrastructure/clock/clock.js';
import { createDatabase, type DatabaseService } from './infrastructure/db/database.js';
import { createLoggerOptions } from './infrastructure/logging/logger.js';
import { LocalStorageDriver } from './infrastructure/storage/local-storage.js';
import type { StorageDriver } from './infrastructure/storage/storage-driver.js';
import systemStatusRoutes from './modules/system-status/routes.js';

const APPLICATION_VERSION = '0.1.0';

export interface BuildAppOptions {
  readonly clock?: Clock;
  readonly config?: AppConfig;
  readonly database?: DatabaseService;
  readonly loggerStream?: DestinationStream;
  readonly serveStatic?: boolean;
  readonly storage?: StorageDriver;
  readonly webRoot?: string;
}

function isApiPath(pathname: string): boolean {
  return (
    pathname === '/api' ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/assets/') ||
    pathname.startsWith('/health/') ||
    pathname === '/openapi.json'
  );
}

export async function buildApp(options: BuildAppOptions = {}) {
  const config = options.config ?? loadConfig();
  const database = options.database ?? createDatabase(config.databaseUrl);
  const ownsDatabase = options.database === undefined;
  const storage = options.storage ?? new LocalStorageDriver(config.storageLocalPath);
  const clock = options.clock ?? new SystemClock();
  const logger = pino(createLoggerOptions(config.logLevel), options.loggerStream);

  const app = Fastify({
    genReqId: () => randomUUID(),
    logController: new LogController({ disableRequestLogging: false }),
    loggerInstance: logger,
    requestIdHeader: 'x-request-id',
    trustProxy: config.trustProxy,
  });

  app.addHook('onSend', async (request, reply) => {
    void reply.header('x-request-id', request.id);
  });

  if (ownsDatabase) {
    app.addHook('onClose', async () => database.close());
  }

  await app.register(swagger, {
    openapi: {
      info: {
        description: 'Club modular monolith HTTP API',
        title: 'Club API',
        version: APPLICATION_VERSION,
      },
      openapi: '3.1.0',
    },
  });

  await app.register(systemStatusRoutes, {
    clock,
    database,
    storage,
    version: APPLICATION_VERSION,
  });

  app.get(
    '/openapi.json',
    {
      schema: {
        hide: true,
        response: { 200: Type.Any() },
      },
    },
    () => app.swagger(),
  );

  const shouldServeStatic = options.serveStatic ?? config.nodeEnv === 'production';
  const webRoot = resolve(options.webRoot ?? 'dist/web');
  if (shouldServeStatic) {
    await app.register(fastifyStatic, {
      decorateReply: false,
      immutable: true,
      maxAge: '1y',
      prefix: '/assets/',
      root: join(webRoot, 'assets'),
      wildcard: true,
    });
  }

  app.setNotFoundHandler(async (request, reply) => {
    const pathname = request.url.split('?', 1)[0] ?? request.url;
    const acceptsHtml = request.headers.accept?.includes('text/html') ?? false;
    if (shouldServeStatic && request.method === 'GET' && acceptsHtml && !isApiPath(pathname)) {
      const index = await readFile(join(webRoot, 'index.html'), 'utf8');
      return reply.type('text/html; charset=utf-8').send(index);
    }

    return reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
        requestId: request.id,
      },
    });
  });

  app.setErrorHandler(async (error: FastifyError, request, reply) => {
    const statusCode = error instanceof AppError ? error.statusCode : error.validation ? 400 : 500;
    const code =
      error instanceof AppError
        ? error.code
        : error.validation
          ? 'VALIDATION_ERROR'
          : 'INTERNAL_SERVER_ERROR';
    const message =
      error instanceof AppError
        ? error.message
        : error.validation
          ? 'The request did not match the expected schema.'
          : 'An unexpected error occurred.';

    if (statusCode >= 500) request.log.error({ err: error }, 'request failed');
    else request.log.info({ code, statusCode }, 'request rejected');

    return reply.status(statusCode).send({
      error: { code, message, requestId: request.id },
    });
  });

  return app;
}
