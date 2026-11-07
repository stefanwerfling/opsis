import fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import multipart from '@fastify/multipart';
import type { AppContext, EventBus } from '@opsis/core';
import { MULTIPART_LIMITS, registerApiRoutes } from './http/api-routes.js';
import { errorHandler } from './http/errors.js';
import { registerEventsRoute } from './http/events-route.js';
import { createHostGuard } from './http/host-guard.js';

export interface BuildAppOptions {
  readonly ctx: AppContext;
  readonly bus: EventBus;
  readonly allowedHosts?: readonly string[];
  readonly logger?: FastifyServerOptions['logger'];
}

export const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]'] as const;

/** Builds the HTTP application (REST + SSE). The MCP endpoint is mounted here in phase 5. */
export const buildApp = async (options: BuildAppOptions): Promise<FastifyInstance> => {
  const app = fastify({
    logger: options.logger ?? false,
    bodyLimit: 1024 * 1024,
  });
  app.setErrorHandler(errorHandler);
  app.addHook('onRequest', createHostGuard([...LOCAL_HOSTNAMES, ...(options.allowedHosts ?? [])]));
  await app.register(multipart, { limits: MULTIPART_LIMITS });
  registerApiRoutes(app, options.ctx);
  registerEventsRoute(app, options.bus);
  return app;
};
