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

/**
 * Client-side routes (`/projects/…`, `/sessions/…`) get the app shell. Paths with a file
 * extension are real files: a missing one must be a 404 – answering a missing script with
 * HTML would leave the browser with a blank page instead of a visible error.
 */
export const isAppRoute = (method: string, url: string): boolean => {
  if (method !== 'GET' && method !== 'HEAD') return false;
  const path = url.split('?')[0] ?? '';
  if (path.startsWith('/api/') || path.startsWith('/assets/')) return false;
  const lastSegment = path.slice(path.lastIndexOf('/') + 1);
  return !lastSegment.includes('.');
};

/** Serves the built single-page app; client routes fall back to index.html. */
const registerWebUi = async (app: FastifyInstance, root: string): Promise<void> => {
  await app.register(fastifyStatic, {
    root,
    // Resolve files per request (not a route table built at startup), so a rebuild of the
    // web UI while the server runs is served correctly.
    wildcard: true,
    index: false,
    setHeaders: (reply, path) => {
      // Vite puts content-hashed files under /assets – safe to cache forever.
      const immutable = path.includes(`${sep}assets${sep}`);
      reply.header('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });
  // The root is a directory for the static plugin (403 without index); serve the shell.
  app.get('/', async (_request, reply) => reply.header('cache-control', 'no-cache').sendFile('index.html'));
  app.setNotFoundHandler(async (request, reply) => {
    if (isAppRoute(request.method, request.url))
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });
};
