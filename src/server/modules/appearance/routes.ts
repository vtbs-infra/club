import type { FastifyPluginAsync } from 'fastify';

import { AppearanceSchema, UpdateAppearanceSchema } from '../../../shared/contracts/appearance.js';
import type { AppAuth, AuthSession } from '../auth/auth.js';
import { createRequirePlatformAdmin } from '../auth/guards.js';
import type { AppearanceService } from './appearance-service.js';

interface AppearanceRoutesOptions {
  readonly auth: AppAuth;
  readonly service: AppearanceService;
}

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
  const requirePlatformAdmin = createRequirePlatformAdmin(options.auth);

  app.get(
    '/api/v1/appearance',
    {
      schema: {
        response: { 200: AppearanceSchema },
        tags: ['appearance'],
      },
    },
    () => options.service.get(),
  );

  app.put<{ Body: typeof UpdateAppearanceSchema.static }>(
    '/api/v1/admin/appearance',
    {
      preHandler: requirePlatformAdmin,
      schema: {
        body: UpdateAppearanceSchema,
        response: { 200: AppearanceSchema },
        tags: ['appearance'],
      },
    },
    (request) => options.service.update(request.body.themePreset, auditContext(request)),
  );

  return Promise.resolve();
};

export default appearanceRoutes;
