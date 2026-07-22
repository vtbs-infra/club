import type { FastifyPluginAsync } from 'fastify';

import type { AppAuth } from './auth.js';

interface AuthRoutesOptions {
  readonly auth: AppAuth;
}

const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = (app, options) => {
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    async handler(request, reply) {
      const origin = `${request.protocol}://${request.headers.host ?? 'localhost'}`;
      const url = new URL(request.url, origin);
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (value === undefined) continue;
        headers.set(name, Array.isArray(value) ? value.join(',') : value);
      }

      const authRequest = new Request(url, {
        method: request.method,
        headers,
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      });
      const response = await options.auth.handler(authRequest);
      reply.status(response.status);

      for (const [name, value] of response.headers) {
        if (name !== 'set-cookie') reply.header(name, value);
      }
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) reply.header('set-cookie', cookies);

      if (!response.body) return reply.send();
      return reply.send(Buffer.from(await response.arrayBuffer()));
    },
  });
  return Promise.resolve();
};

export default authRoutes;
