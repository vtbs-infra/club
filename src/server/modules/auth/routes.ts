import { randomBytes } from 'node:crypto';
import { Type, type Static } from '@sinclair/typebox';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  AuthSessionSchema,
  AuthUserSchema,
  ChallengeSchema,
  CreateChallengeBodySchema,
  RegisterBodySchema,
  LoginBodySchema,
  RecoverBodySchema,
  ChangePasswordBodySchema,
  UpdateProfileBodySchema,
} from '../../../shared/contracts/auth.js';
import { IdSchema, Nullable } from '../../../shared/contracts/common.js';
import { AppError } from '../../../shared/errors/app-error.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { AppConfig } from '../../config/env.js';
import { InMemoryRateLimiter } from '../../infrastructure/security/request-security.js';
import type { AppAuth } from './auth.js';
import { createRequireSession } from './guards.js';
import { CHALLENGE_COOKIE, type IdentityService } from './identity-service.js';
import { SESSION_COOKIE } from './session-store.js';

interface Options {
  auth: AppAuth;
  identities: IdentityService;
  clock: Clock;
  config: AppConfig;
  challengeLimiter: InMemoryRateLimiter;
}
const authRoutes: FastifyPluginAsync<Options> = (app, options) => {
  const requireSession = createRequireSession(options.auth);
  const loginLimiter = new InMemoryRateLimiter(20, 60_000);
  const pollLimiter = new InMemoryRateLimiter(120, 60_000);
  function owner(request: FastifyRequest): string {
    const token = request.cookies[CHALLENGE_COOKIE];
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new AppError('IDENTITY_BROWSER_REQUIRED', 'Start verification in this browser.', 400);
    return token;
  }
  function throttle(limiter: InMemoryRateLimiter, key: string, reply: FastifyReply) {
    const result = limiter.consume(key, options.clock.now());
    if (!result.allowed) {
      void reply.header('retry-after', String(result.retryAfterSeconds));
      throw new AppError('RATE_LIMITED', 'Try again later.', 429);
    }
  }
  app.get(
    '/api/v1/auth/session',
    { schema: { response: { 200: Nullable(AuthSessionSchema) }, tags: ['auth'] } },
    (request) => options.auth.getSession(request),
  );
  app.post<{ Body: Static<typeof CreateChallengeBodySchema> }>(
    '/api/v1/auth/challenges',
    {
      schema: {
        body: CreateChallengeBodySchema,
        response: { 201: ChallengeSchema },
        tags: ['auth'],
      },
    },
    async (request, reply) => {
      throttle(options.challengeLimiter, 'identity:' + request.ip, reply);
      const token = request.cookies[CHALLENGE_COOKIE];
      const browser =
        token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : randomBytes(32).toString('base64url');
      void reply.setCookie(CHALLENGE_COOKIE, browser, {
        httpOnly: true,
        secure: options.config.nodeEnv === 'production',
        sameSite: 'lax',
        path: '/api/v1/auth',
        maxAge: 24 * 60 * 60,
      });
      return reply
        .status(201)
        .send(await options.identities.createChallenge(browser, request.body));
    },
  );
  app.get<{ Params: { id: string } }>(
    '/api/v1/auth/challenges/:id',
    {
      schema: {
        params: Type.Object({ id: IdSchema }),
        response: { 200: ChallengeSchema },
        tags: ['auth'],
      },
    },
    (request, reply) => {
      throttle(pollLimiter, 'identity-poll:' + request.ip, reply);
      return options.identities.getChallenge(request.params.id, owner(request));
    },
  );
  app.post<{ Body: Static<typeof RegisterBodySchema> }>(
    '/api/v1/auth/register',
    {
      schema: { body: RegisterBodySchema, response: { 201: AuthUserSchema }, tags: ['auth'] },
    },
    async (request, reply) =>
      reply.status(201).send(await options.identities.register(owner(request), request.body)),
  );
  app.post<{ Body: Static<typeof LoginBodySchema> }>(
    '/api/v1/auth/login',
    {
      schema: { body: LoginBodySchema, response: { 200: AuthSessionSchema }, tags: ['auth'] },
    },
    (request, reply) => {
      throttle(loginLimiter, 'login:' + request.ip, reply);
      return options.auth.login(request, request.body.username, request.body.password);
    },
  );
  app.post(
    '/api/v1/auth/logout',
    { schema: { response: { 204: Type.Null() }, tags: ['auth'] } },
    async (request, reply) => {
      await request.session.destroy();
      request.authSession = null;
      void reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return reply.status(204).send();
    },
  );
  app.post<{ Body: Static<typeof RecoverBodySchema> }>(
    '/api/v1/auth/recover',
    {
      schema: { body: RecoverBodySchema, response: { 204: Type.Null() }, tags: ['auth'] },
    },
    async (request, reply) => {
      await options.identities.recover(
        owner(request),
        request.body.challengeId,
        request.body.password,
      );
      await request.session.destroy();
      void reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return reply.status(204).send();
    },
  );
  app.post<{ Body: Static<typeof ChangePasswordBodySchema> }>(
    '/api/v1/auth/password',
    {
      preHandler: requireSession,
      schema: { body: ChangePasswordBodySchema, response: { 204: Type.Null() }, tags: ['auth'] },
    },
    async (request, reply) => {
      await options.auth.changePassword(
        request.authSession!.user.id,
        request.body.currentPassword,
        request.body.password,
      );
      await request.session.destroy();
      request.authSession = null;
      void reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return reply.status(204).send();
    },
  );
  app.patch<{ Body: Static<typeof UpdateProfileBodySchema> }>(
    '/api/v1/me/profile',
    {
      preHandler: requireSession,
      schema: { body: UpdateProfileBodySchema, response: { 200: AuthUserSchema }, tags: ['auth'] },
    },
    (request) => options.auth.updateProfile(request.authSession!.user.id, request.body.name),
  );
  return Promise.resolve();
};
export default authRoutes;
