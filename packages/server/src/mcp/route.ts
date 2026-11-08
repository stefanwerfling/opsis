import { createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler, type NodeIncomingMessageLike } from '@modelcontextprotocol/node';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { IMAGE_LIMITS, OpsisError, type Actor, type AppContext } from '@opsis/core';
import { requireAgent } from '../http/agent-auth.js';
import { createOpsisMcpServer, type McpServerOptions } from './server.js';

/** A base64 image of the maximum size plus the JSON-RPC envelope and metadata. */
export const MCP_BODY_LIMIT = Math.ceil(IMAGE_LIMITS.maxBytes / 3) * 4 + 1024 * 1024;

export interface McpRouteOptions {
  /** Public base URL of the web UI (links in tool results). */
  readonly baseUrl: string;
  /** Host names accepted in an `Origin` header (DNS-rebinding protection, 06 §1). */
  readonly allowedOriginHosts: readonly string[];
  readonly wait?: McpServerOptions['wait'];
}

const actorOf = (extra: Record<string, unknown> | undefined): Actor => {
  const actor = extra?.['actor'];
  if (typeof actor !== 'object' || actor === null) throw new Error('MCP request without agent');
  return actor as Actor;
};

const signalOf = (extra: Record<string, unknown> | undefined): AbortSignal | undefined => {
  const signal = extra?.['signal'];
  return signal instanceof AbortSignal ? signal : undefined;
};

interface JsonRpcLike {
  readonly method?: unknown;
  readonly id?: unknown;
  readonly params?: { readonly requestId?: unknown };
}

const requestKey = (agentId: string, id: unknown): string | undefined =>
  typeof id === 'string' || typeof id === 'number' ? `${agentId}:${String(id)}` : undefined;

/**
 * Cancellation of running tool calls. Stateless 2025-era clients send
 * `notifications/cancelled` as a separate POST that reaches a fresh server instance, so the
 * running call would never learn about it. The endpoint therefore keeps an abort handle per
 * agent and JSON-RPC id; a closed connection aborts as well.
 */
class InflightCalls {
  readonly #calls = new Map<string, AbortController>();

  start(key: string, response: { on(event: 'close', listener: () => void): unknown }): AbortSignal {
    const controller = new AbortController();
    this.#calls.get(key)?.abort();
    this.#calls.set(key, controller);
    response.on('close', () => {
      if (this.#calls.get(key) === controller) this.#calls.delete(key);
      controller.abort();
    });
    return controller.signal;
  }

  cancel(key: string): void {
    this.#calls.get(key)?.abort();
  }
}

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
    ({ authInfo }) => {
      const signal = signalOf(authInfo?.extra);
      return createOpsisMcpServer(
        {
          ctx,
          baseUrl: options.baseUrl,
          ...(options.wait ? { wait: options.wait } : {}),
          ...(signal ? { signal } : {}),
        },
        actorOf(authInfo?.extra),
      );
    },
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
  const inflight = new InflightCalls();
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
      const message = (request.body ?? {}) as JsonRpcLike;
      const key = requestKey(
        actor.id,
        message.method === 'notifications/cancelled' ? message.params?.requestId : message.id,
      );
      if (key !== undefined && message.method === 'notifications/cancelled') inflight.cancel(key);
      const signal =
        key !== undefined && message.method === 'tools/call' ? inflight.start(key, reply.raw) : undefined;
      reply.hijack();
      // The token itself is not passed on; tools only need the actor.
      const raw: NodeIncomingMessageLike = {
        method: request.method,
        url: request.raw.url ?? '/mcp',
        headers: request.raw.headers,
        auth: { token: '', clientId: actor.id, scopes: [], extra: { actor, ...(signal ? { signal } : {}) } },
        [Symbol.asyncIterator]: () => request.raw[Symbol.asyncIterator](),
      };
      await node(raw, reply.raw, request.body ?? undefined);
    },
  });
  return handler;
};
