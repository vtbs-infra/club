import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';

import { UI_THEMES, type UiTheme } from '../../../shared/ui-theme.js';
import type { AppAuth, AuthSession } from '../auth/auth.js';
import { createRequirePlatformAdmin } from '../auth/guards.js';
import type { AppearanceService } from './appearance-service.js';

interface AppearanceRoutesOptions {
  readonly auth: AppAuth;
  readonly service: AppearanceService;
}

const ThemeSchema = Type.Union(UI_THEMES.map((theme) => Type.Literal(theme)));
const PublicAppearanceSchema = Type.Object({ theme: ThemeSchema });
const AppearanceSchema = Type.Object({
  activeTheme: ThemeSchema,
  deploymentTheme: ThemeSchema,
  overrideTheme: Type.Union([Type.Null(), ThemeSchema]),
  updatedAt: Type.Union([Type.Null(), Type.String({ format: 'date-time' })]),
  updatedByUserId: Type.Union([Type.Null(), Type.String({ format: 'uuid' })]),
  version: Type.Integer({ minimum: 0 }),
});

function auditContext(request: {
  readonly authSession: AuthSession | null;
  readonly id: string;
  readonly ip: string;
}) {
  if (!request.authSession) throw new Error('Authenticated route is missing its session.');
  return {
    actorUserId: request.authSession.user.id,
    ipAddress: request.ip,
    requestId: request.id,
  };
}

const appearanceRoutes: FastifyPluginAsync<AppearanceRoutesOptions> = (app, options) => {
  const requireAdmin = createRequirePlatformAdmin(options.auth);

  app.get(
    '/api/v1/ui-theme',
    {
      schema: { response: { 200: PublicAppearanceSchema }, tags: ['appearance'] },
    },
    async () => {
      const state = await options.service.get();
      return { theme: state.activeTheme };
    },
  );

  app.get(
    '/api/v1/admin/appearance',
    {
      preHandler: requireAdmin,
      schema: { response: { 200: AppearanceSchema }, tags: ['appearance'] },
    },
    () => options.service.get(),
  );

  app.put<{ Body: { expectedVersion: number; theme: UiTheme } }>(
    '/api/v1/admin/appearance',
    {
      preHandler: requireAdmin,
      schema: {
        body: Type.Object(
          {
            expectedVersion: Type.Integer({ minimum: 0 }),
            theme: ThemeSchema,
          },
          { additionalProperties: false },
        ),
        response: { 200: AppearanceSchema },
        tags: ['appearance'],
      },
    },
    (request) =>
      options.service.update({
        ...auditContext(request),
        expectedVersion: request.body.expectedVersion,
        theme: request.body.theme,
      }),
  );

  app.post<{ Body: { expectedVersion: number } }>(
    '/api/v1/admin/appearance/restore',
    {
      preHandler: requireAdmin,
      schema: {
        body: Type.Object(
          { expectedVersion: Type.Integer({ minimum: 0 }) },
          { additionalProperties: false },
        ),
        response: { 200: AppearanceSchema },
        tags: ['appearance'],
      },
    },
    (request) =>
      options.service.restore({
        ...auditContext(request),
        expectedVersion: request.body.expectedVersion,
      }),
  );

  return Promise.resolve();
};

export default appearanceRoutes;
