import type { FastifyInstance } from 'fastify';
import type { EventBus } from '@opsis/core';

const HEARTBEAT_MS = 25_000;

/**
 * Server-Sent Events: pushes domain events to the browser so the editor learns about new
 * sessions and status changes without polling. The local user sees all projects (E1).
 */
export const registerEventsRoute = (app: FastifyInstance, bus: EventBus): void => {
  app.get('/api/v1/events', (request, reply) => {
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    raw.write(': connected\n\n');

    const unsubscribe = bus.subscribe((event) => {
      raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const heartbeat = setInterval(() => raw.write(': heartbeat\n\n'), HEARTBEAT_MS);
    const close = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    request.raw.on('close', close);
    raw.on('error', close);
  });
};
