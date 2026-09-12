import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import Fastify, { LogController, type FastifyError } from 'fastify';
import pino, { type DestinationStream } from 'pino';

import { APPLICATION_VERSION } from './application-version.js';
import type { AppConfig } from './config/env.js';
import { SystemClock, type Clock } from './infrastructure/clock/clock.js';
import { createLoggerOptions } from './infrastructure/logging/logger.js';
import { publicHttpError } from './infrastructure/security/http-error.js';
import { LivenessResponseSchema } from '../shared/contracts/health.js';

export interface HttpAppOptions {
  readonly config: Pick<AppConfig, 'nodeEnv' | 'logLevel' | 'trustProxy'>;
  readonly clock?: Clock;
  readonly loggerStream?: DestinationStream;
  readonly serveStatic?: boolean;
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

export async function buildHttpApp(options: HttpAppOptions) {
  const { config } = options;
  const clock = options.clock ?? new SystemClock();
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
    void reply.header('x-content-type-options', 'nosniff');
    void reply.header('x-frame-options', 'DENY');
    void reply.header('referrer-policy', 'no-referrer');
    void reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    void reply.header(
      'content-security-policy',
      "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; form-action 'self'; img-src 'self' data: blob: https:; connect-src 'self' https: wss:; style-src 'self' 'unsafe-inline'; script-src 'self'",
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

  app.setErrorHandler(async (error: FastifyError, request, reply) => {
    const { statusCode, code, message } = publicHttpError(error);

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

  app.get(
    '/health/live',
    {
      schema: { response: { 200: LivenessResponseSchema }, tags: ['system'] },
    },
    () => ({ now: clock.now().toISOString(), status: 'ok' as const, version: APPLICATION_VERSION }),
  );

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
