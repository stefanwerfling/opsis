import { createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler, type NodeIncomingMessageLike } from '@modelcontextprotocol/node';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { IMAGE_LIMITS, OpsisError, type Actor, type AppContext } from '@opsis/core';
import { requireAgent } from '../http/agent-auth.js';
import { createOpsisMcpServer } from './server.js';

/** A base64 image of the maximum size plus the JSON-RPC envelope and metadata. */
export const MCP_BODY_LIMIT = Math.ceil(IMAGE_LIMITS.maxBytes / 3) * 4 + 1024 * 1024;

export interface McpRouteOptions {
  /** Public base URL of the web UI (links in tool results). */
  readonly baseUrl: string;
  /** Host names accepted in an `Origin` header (DNS-rebinding protection, 06 §1). */
  readonly allowedOriginHosts: readonly string[];
}

const actorOf = (extra: Record<string, unknown> | undefined): Actor => {
  const actor = extra?.['actor'];
  if (typeof actor !== 'object' || actor === null) throw new Error('MCP request without agent');
  return actor as Actor;
};

/** Browsers send `Origin`; agents usually do not. A foreign origin is always rejected. */
const assertOrigin = (request: FastifyRequest, allowed: readonly string[]): void => {
  const origin = request.headers.origin;
  if (origin === undefined) return;
  let hostname: string;
  try {
    hostname = new URL(origin).hostname.toLowerCase();
  } catch {
    throw new OpsisError('FORBIDDEN_ACTOR', 'Origin not allowed');
  }
  const bare = hostname.startsWith('[') ? hostname : hostname.replace(/^\[|\]$/g, '');
  if (!allowed.includes(bare) && !allowed.includes(`[${bare}]`)) {
    throw new OpsisError('FORBIDDEN_ACTOR', 'Origin not allowed');
  }
};

/**
 * Mounts the MCP endpoint (Streamable HTTP) under `/mcp`. Every request authenticates
 * with the agent's bearer token first; the per-request MCP server is bound to that agent.
 */
export const registerMcpRoute = (
  app: FastifyInstance,
  ctx: AppContext,
  options: McpRouteOptions,
): McpHttpHandler => {
  const handler = createMcpHandler(
    ({ authInfo }) => createOpsisMcpServer({ ctx, baseUrl: options.baseUrl }, actorOf(authInfo?.extra)),
    {
      onerror: (error) => {
        app.log.warn({ err: error }, 'mcp request failed');
      },
    },
  );
  const node = toNodeHandler(handler, {
    maxRequestBodySize: MCP_BODY_LIMIT,
    onerror: (error) => {
      app.log.error({ err: error }, 'mcp handler error');
    },
  });
  app.addHook('onClose', async () => {
    await handler.close();
  });

  app.route({
    method: ['GET', 'POST', 'DELETE'],
    url: '/mcp',
    bodyLimit: MCP_BODY_LIMIT,
    handler: async (request, reply) => {
      assertOrigin(request, options.allowedOriginHosts);
      const actor = requireAgent(ctx, request);
      reply.hijack();
      // The token itself is not passed on; tools only need the actor.
      const raw: NodeIncomingMessageLike = {
        method: request.method,
        url: request.raw.url ?? '/mcp',
        headers: request.raw.headers,
        auth: { token: '', clientId: actor.id, scopes: [], extra: { actor } },
        [Symbol.asyncIterator]: () => request.raw[Symbol.asyncIterator](),
      };
      await node(raw, reply.raw, request.body ?? undefined);
    },
  });
  return handler;
};
