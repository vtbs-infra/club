import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import Fastify, { LogController, type FastifyError } from 'fastify';
import pino, { type DestinationStream } from 'pino';

import { AppError } from '../shared/errors/app-error.js';
import { APPLICATION_VERSION } from './application-version.js';
import { loadConfig, type AppConfig } from './config/env.js';
import { SystemClock, type Clock } from './infrastructure/clock/clock.js';
import { createDatabase, type DatabaseService } from './infrastructure/db/database.js';
import { EncryptionKeyRing } from './infrastructure/encryption/key-ring.js';
import { createLoggerOptions } from './infrastructure/logging/logger.js';
import { LocalStorageDriver } from './infrastructure/storage/local-storage.js';
import type { StorageDriver } from './infrastructure/storage/storage-driver.js';
import {
  InMemoryRateLimiter,
  registerRequestSecurity,
} from './infrastructure/security/request-security.js';
import { createAuth, type AppAuth } from './modules/auth/auth.js';
import authRoutes from './modules/auth/routes.js';
import { AddressService } from './modules/addresses/address-service.js';
import addressRoutes from './modules/addresses/routes.js';
import { createBindingRuntime, type BindingRuntime } from './modules/binding/binding-runtime.js';
import bindingRoutes from './modules/binding/routes.js';
import { AnnouncementService } from './modules/announcements/announcement-service.js';
import announcementRoutes from './modules/announcements/routes.js';
import { AppearanceService } from './modules/appearance/appearance-service.js';
import appearanceRoutes from './modules/appearance/routes.js';
import { AuditQueryService } from './modules/audit/audit-query-service.js';
import auditRoutes from './modules/audit/routes.js';
import type { CreatorProfileSource } from './modules/bilibili/creator-profile-source.js';
import { FakeCreatorProfileSource } from './modules/bilibili/fake-creator-profile-source.js';
import { PublicWebCreatorProfileSource } from './modules/bilibili/public-web-creator-profile-source.js';
import { CreatorService } from './modules/creators/creator-service.js';
import creatorRoutes from './modules/creators/routes.js';
import {
  createFulfillmentRuntime,
  type FulfillmentRuntime,
} from './modules/fulfillment/fulfillment-runtime.js';
import {
  createGiftMediaRuntime,
  type GiftMediaRuntime,
} from './modules/gifts/gift-media-runtime.js';
import giftMediaRoutes from './modules/gifts/gift-media-routes.js';
import giftOrderRoutes from './modules/gifts/order-routes.js';
import giftReleaseRoutes from './modules/gifts/release-routes.js';
import { GiftReleaseService } from './modules/gifts/release-service.js';
import { PortalService } from './modules/portal/portal-service.js';
import portalRoutes from './modules/portal/routes.js';
import systemStatusRoutes from './modules/system-status/routes.js';
import snapshotRoutes from './modules/snapshots/routes.js';
import {
  createSnapshotRuntime,
  type SnapshotRuntime,
} from './modules/snapshots/snapshot-runtime.js';
import verificationRoomRoutes from './modules/verification-rooms/routes.js';

export interface BuildAppOptions {
  readonly auth?: AppAuth;
  readonly bindingRuntime?: BindingRuntime;
  readonly challengeLimiter?: InMemoryRateLimiter;
  readonly clock?: Clock;
  readonly config?: AppConfig;
  readonly creatorProfileSource?: CreatorProfileSource;
  readonly database?: DatabaseService;
  readonly fulfillmentRuntime?: FulfillmentRuntime;
  readonly giftMediaRuntime?: GiftMediaRuntime;
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
  const logger = pino(createLoggerOptions(config.logLevel), options.loggerStream);
  const reportRuntimeError = (error: unknown, operation: string) => {
    logger.error({ err: error, operation }, 'background runtime operation failed');
  };
  const auth = options.auth ?? createAuth({ config, database });
  const encryption = new EncryptionKeyRing(config);
  const rateLimiter = options.rateLimiter ?? new InMemoryRateLimiter();
  const challengeLimiter = options.challengeLimiter ?? new InMemoryRateLimiter(5, 10 * 60_000);
  const bindingRuntime =
    options.bindingRuntime ??
    createBindingRuntime({ clock, config, database, reportError: reportRuntimeError });
  const creatorProfileSource =
    options.creatorProfileSource ??
    (config.bilibiliRosterSource === 'fake'
      ? new FakeCreatorProfileSource()
      : new PublicWebCreatorProfileSource());
  const addressService = new AddressService(database, encryption);
  const creatorService = new CreatorService(database, creatorProfileSource, clock);
  const releaseService = new GiftReleaseService(database, clock);
  const announcementService = new AnnouncementService(database, clock);
  const appearanceService = new AppearanceService(database);
  const portalService = new PortalService(database, clock);
  const auditQueryService = new AuditQueryService(database);
  const giftMediaRuntime =
    options.giftMediaRuntime ??
    createGiftMediaRuntime({
      clock,
      database,
      reportError: reportRuntimeError,
      storage,
    });
  const fulfillmentRuntime =
    options.fulfillmentRuntime ??
    createFulfillmentRuntime({
      addresses: addressService,
      clock,
      config,
      database,
      encryption,
      reportError: reportRuntimeError,
    });
  const snapshotRuntime =
    options.snapshotRuntime ??
    createSnapshotRuntime({
      clock,
      config,
      database,
      onFinalized: (runId, executor) =>
        releaseService.eligibility.reconcileSnapshot(runId, executor),
      reportError: reportRuntimeError,
      storage,
    });

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
    void reply.header('x-content-type-options', 'nosniff');
    void reply.header('x-frame-options', 'DENY');
    void reply.header('referrer-policy', 'no-referrer');
    void reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    void reply.header(
      'content-security-policy',
      "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; form-action 'self'; img-src 'self' data: https:; connect-src 'self' https: wss:; style-src 'self' 'unsafe-inline'; script-src 'self'",
    );
    if (
      request.url.startsWith('/api/') ||
      request.url.startsWith('/health/') ||
      request.url === '/openapi.json'
    ) {
      if (!/^\/api\/v1\/gift-releases\/[^/]+\/cover(?:\?|$)/.test(request.url)) {
        void reply.header('cache-control', 'no-store');
      }
    }
    if (config.nodeEnv === 'production') {
      void reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    }
  });

  app.addHook('onClose', async () => {
    const closeRuntimes = [
      () => bindingRuntime.close(),
      () => snapshotRuntime.close(),
      () => fulfillmentRuntime.close(),
      () => giftMediaRuntime.close(),
    ];
    const results = await Promise.allSettled(
      closeRuntimes.map(async (closeRuntime) => closeRuntime()),
    );
    const failures: unknown[] = [];
    for (const result of results) {
      if (result.status === 'rejected') failures.push(result.reason);
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'One or more background runtimes failed to stop.');
    }
    if (ownsDatabase) await database.close();
  });
  const backgroundRequired = options.startBackground ?? config.nodeEnv !== 'test';
  if (backgroundRequired) {
    app.addHook('onReady', async () => {
      const runtimes = [
        ['binding', bindingRuntime.start()],
        ['snapshot', snapshotRuntime.start()],
        ['fulfillment', fulfillmentRuntime.start()],
        ['gift-media', giftMediaRuntime.start()],
      ] as const;
      const results = await Promise.allSettled(runtimes.map(([, start]) => start));
      for (const [index, result] of results.entries()) {
        if (result.status === 'rejected') {
          app.log.error(
            { err: result.reason, runtime: runtimes[index]![0] },
            'background runtime startup failed',
          );
        }
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
  await app.register(addressRoutes, { auth, service: addressService });
  await app.register(creatorRoutes, { auth, database, service: creatorService });
  await app.register(bindingRoutes, {
    auth,
    challengeLimiter,
    clock,
    conflicts: bindingRuntime.conflicts,
    service: bindingRuntime.bindings,
  });
  await app.register(giftReleaseRoutes, { auth, database, service: releaseService });
  await app.register(giftOrderRoutes, {
    auth,
    database,
    service: fulfillmentRuntime.service,
  });
  await app.register(giftMediaRoutes, { auth, database, service: giftMediaRuntime.service });
  await app.register(verificationRoomRoutes, { auth, service: bindingRuntime.rooms });
  await app.register(snapshotRoutes, { auth, database, service: snapshotRuntime.service });
  await app.register(announcementRoutes, {
    auth,
    database,
    service: announcementService,
  });
  await app.register(portalRoutes, { service: portalService });
  await app.register(appearanceRoutes, { auth, service: appearanceService });
  await app.register(auditRoutes, {
    auth,
    service: auditQueryService,
  });

  await app.register(systemStatusRoutes, {
    auth,
    backgroundRequired,
    bindingRuntime,
    clock,
    database,
    fulfillmentRuntime,
    giftMediaRuntime,
    snapshotRuntime,
    storage,
    version: APPLICATION_VERSION,
  });

  app.get(
    '/openapi.json',
    {
      schema: {
        hide: true,
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
      return reply.header('cache-control', 'no-store').type('text/html; charset=utf-8').send(index);
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
