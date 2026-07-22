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
import {
  InMemoryRateLimiter,
  registerRequestSecurity,
} from './infrastructure/security/request-security.js';
import { createAuth, type AppAuth } from './modules/auth/auth.js';
import authRoutes from './modules/auth/routes.js';
import { createBindingRuntime, type BindingRuntime } from './modules/binding/binding-runtime.js';
import bindingRoutes from './modules/binding/routes.js';
import { CampaignService } from './modules/campaigns/campaign-service.js';
import campaignRoutes from './modules/campaigns/routes.js';
import organizationRoutes from './modules/organizations/routes.js';
import systemStatusRoutes from './modules/system-status/routes.js';
import snapshotRoutes from './modules/snapshots/routes.js';
import {
  createSnapshotRuntime,
  type SnapshotRuntime,
} from './modules/snapshots/snapshot-runtime.js';
import verificationRoomRoutes from './modules/verification-rooms/routes.js';

const APPLICATION_VERSION = '0.1.0';

export interface BuildAppOptions {
  readonly auth?: AppAuth;
  readonly bindingRuntime?: BindingRuntime;
  readonly challengeLimiter?: InMemoryRateLimiter;
  readonly clock?: Clock;
  readonly config?: AppConfig;
  readonly database?: DatabaseService;
  readonly loggerStream?: DestinationStream;
  readonly rateLimiter?: InMemoryRateLimiter;
  readonly serveStatic?: boolean;
  readonly snapshotRuntime?: SnapshotRuntime;
  readonly startBackground?: boolean;
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
  const auth = options.auth ?? createAuth({ config, database });
  const rateLimiter = options.rateLimiter ?? new InMemoryRateLimiter();
  const challengeLimiter = options.challengeLimiter ?? new InMemoryRateLimiter(5, 10 * 60_000);
  const bindingRuntime =
    options.bindingRuntime ?? createBindingRuntime({ clock, config, database });
  const campaignService = new CampaignService(database, clock);
  const snapshotRuntime =
    options.snapshotRuntime ??
    createSnapshotRuntime({
      clock,
      config,
      database,
      onFinalized: (runId, executor) => campaignService.reconcileSnapshot(runId, executor),
      storage,
    });
  const logger = pino(createLoggerOptions(config.logLevel), options.loggerStream);

  const app = Fastify({
    ajv: { customOptions: { removeAdditional: false } },
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
  app.addHook('onClose', async () => bindingRuntime.close());
  app.addHook('onClose', () => snapshotRuntime.close());
  if (options.startBackground ?? config.nodeEnv !== 'test') {
    app.addHook('onReady', async () => {
      try {
        await bindingRuntime.start();
        await snapshotRuntime.start();
      } catch (error) {
        app.log.error({ err: error }, 'binding runtime startup failed');
      }
    });
  }

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

  await app.register(authRoutes, { auth });
  registerRequestSecurity(app, { auth, clock, config, rateLimiter });
  await app.register(organizationRoutes, { auth, database });
  await app.register(bindingRoutes, {
    auth,
    challengeLimiter,
    clock,
    service: bindingRuntime.bindings,
  });
  await app.register(campaignRoutes, { auth, service: campaignService });
  await app.register(verificationRoomRoutes, { auth, service: bindingRuntime.rooms });
  await app.register(snapshotRoutes, { auth, service: snapshotRuntime.service });

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

  return app;
}
