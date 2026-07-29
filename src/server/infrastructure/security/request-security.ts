import type {
  FastifyBaseLogger,
  FastifyInstance,
  FastifyTypeProvider,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerBase,
} from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';

import { AppError } from '../../../shared/errors/app-error.js';
import type { AppConfig } from '../../config/env.js';
import '../../types/fastify.js';
import type { Clock } from '../clock/clock.js';
import type { AppAuth } from '../../modules/auth/auth.js';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

export class InMemoryRateLimiter {
  private readonly entries = new Map<string, RateLimitEntry>();
  private operations = 0;

  public constructor(
    private readonly limit = 120,
    private readonly windowMs = 60_000,
    private readonly maxEntries = 10_000,
  ) {
    if (limit < 1 || windowMs < 1 || maxEntries < 1) {
      throw new RangeError('Rate limiter values must be positive.');
    }
  }

  public get entryCount(): number {
    return this.entries.size;
  }

  private pruneExpired(nowMs: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= nowMs) this.entries.delete(key);
    }
  }

  private makeCapacity(nowMs: number): void {
    this.pruneExpired(nowMs);
    if (this.entries.size < this.maxEntries) return;
    let oldestKey: string | null = null;
    let oldestResetAt = Number.POSITIVE_INFINITY;
    for (const [key, entry] of this.entries) {
      if (entry.resetAt < oldestResetAt) {
        oldestKey = key;
        oldestResetAt = entry.resetAt;
      }
    }
    if (oldestKey) this.entries.delete(oldestKey);
  }

  public consume(key: string, now: Date): RateLimitResult {
    const nowMs = now.getTime();
    this.operations += 1;
    if (this.operations % 256 === 0) this.pruneExpired(nowMs);
    const existing = this.entries.get(key);
    if (!existing && this.entries.size >= this.maxEntries) this.makeCapacity(nowMs);
    const entry =
      existing && existing.resetAt > nowMs
        ? existing
        : { count: 0, resetAt: nowMs + this.windowMs };
    entry.count += 1;
    this.entries.set(key, entry);

    return {
      allowed: entry.count <= this.limit,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - nowMs) / 1000)),
    };
  }
}

export interface RequestSecurityOptions {
  readonly auth: AppAuth;
  readonly clock: Clock;
  readonly config: AppConfig;
  readonly rateLimiter: InMemoryRateLimiter;
}

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function registerRequestSecurity<
  RawServer extends RawServerBase,
  RawRequest extends RawRequestDefaultExpression<RawServer>,
  RawReply extends RawReplyDefaultExpression<RawServer>,
  Logger extends FastifyBaseLogger,
  TypeProvider extends FastifyTypeProvider,
>(
  app: FastifyInstance<RawServer, RawRequest, RawReply, Logger, TypeProvider>,
  options: RequestSecurityOptions,
): void {
  const trustedOrigin = new URL(options.config.appUrl).origin;
  app.decorateRequest('authSession', null);
  app.decorateRequest('creatorProfile', null);

  app.addHook('onRequest', (request) => {
    if (!request.url.startsWith('/api/v1/') || !STATE_CHANGING_METHODS.has(request.method)) {
      return Promise.resolve();
    }
    const origin = request.headers.origin;
    let normalizedOrigin: string | null;
    try {
      normalizedOrigin = origin ? new URL(origin).origin : null;
    } catch {
      normalizedOrigin = null;
    }
    if (normalizedOrigin !== trustedOrigin) {
      throw new AppError('CSRF_VALIDATION_FAILED', 'The request origin is not trusted.', 403);
    }
    return Promise.resolve();
  });

  app.addHook('preHandler', async (request, reply) => {
    if (!request.url.startsWith('/api/v1/') || !STATE_CHANGING_METHODS.has(request.method)) return;
    const session = await options.auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });
    request.authSession = session;
    const keys = [`ip:${request.ip}`, ...(session ? [`user:${session.user.id}`] : [])];
    const results = keys.map((key) => options.rateLimiter.consume(key, options.clock.now()));
    if (results.some((result) => !result.allowed)) {
      const retryAfterSeconds = Math.max(...results.map((result) => result.retryAfterSeconds));
      void reply.header('retry-after', String(retryAfterSeconds));
      throw new AppError('RATE_LIMITED', 'Too many requests.', 429);
    }
  });
}
