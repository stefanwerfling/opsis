import { sep } from 'node:path';
import fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
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
  /** Directory of the built web UI (packages/web/dist). Without it only the API is served. */
  readonly webRoot?: string;
}

/**
 * CSP for the web UI: only same-origin scripts, styles, images and connections; no inline
 * scripts, no framing. The UI builds the DOM without innerHTML, so it needs no exceptions.
 */
export const WEB_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' blob: data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

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

  app.addHook('onSend', async (_request, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    const type = reply.getHeader('content-type');
    if (typeof type === 'string' && type.startsWith('text/html')) {
      reply.header('content-security-policy', WEB_CSP);
      reply.header('x-frame-options', 'DENY');
    }
  });

  if (options.webRoot !== undefined) await registerWebUi(app, options.webRoot);
  return app;
};

/** Serves the built single-page app; unknown non-API GET paths fall back to index.html. */
const registerWebUi = async (app: FastifyInstance, root: string): Promise<void> => {
  await app.register(fastifyStatic, {
    root,
    wildcard: false,
    index: false,
    setHeaders: (reply, path) => {
      // Vite puts content-hashed files under /assets – safe to cache forever.
      const immutable = path.includes(`${sep}assets${sep}`);
      reply.header('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });
  app.setNotFoundHandler(async (request, reply) => {
    const isPageRequest =
      (request.method === 'GET' || request.method === 'HEAD') && !request.url.startsWith('/api/');
    if (isPageRequest) return reply.header('cache-control', 'no-cache').sendFile('index.html');
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });
};
