import type { FastifyRequest } from 'fastify';
import { OpsisError, authenticateAgent, type Actor, type AppContext } from '@opsis/core';

const BEARER = /^Bearer ([^\s]+)$/i;

/**
 * Resolves `Authorization: Bearer <token>` to the agent actor (architecture 01 §6). Every
 * failure – missing header, other scheme, unknown or revoked token – is the same 401, so a
 * caller learns nothing about which tokens exist.
 */
export const requireAgent = (ctx: AppContext, request: FastifyRequest): Actor => {
  const header = request.headers.authorization;
  const token = header === undefined ? undefined : BEARER.exec(header)?.[1];
  const agent = token === undefined ? undefined : authenticateAgent(ctx, token);
  if (!agent) throw new OpsisError('UNAUTHENTICATED', 'Missing or invalid agent token');
  return agent;
};
