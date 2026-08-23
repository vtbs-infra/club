import type { FastifyPluginAsync } from 'fastify';

import { PortalHomeSchema } from '../../../shared/contracts/portal.js';
import type { PortalService } from './portal-service.js';

interface PortalRoutesOptions {
  readonly service: PortalService;
}

const portalRoutes: FastifyPluginAsync<PortalRoutesOptions> = (app, options) => {
  app.get(
    '/api/v1/portal/home',
    {
      schema: {
        response: { 200: PortalHomeSchema },
        tags: ['portal'],
      },
    },
    () => options.service.getHome(),
  );
  return Promise.resolve();
};

export default portalRoutes;
