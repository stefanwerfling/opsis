import { z } from 'zod';
import type { Timestamp } from './common.js';
import { ID_PATTERN } from './ids.js';

/**
 * A registered agent identity (architecture 02, 04 §4). Only `sha256(token)` is stored;
 * the token itself is shown exactly once when the agent is created.
 */
export interface Agent {
  readonly id: string;
  readonly name: string;
  readonly createdAt: Timestamp;
  readonly revokedAt: Timestamp | null;
}

export interface AgentWithGrants extends Agent {
  readonly projectIds: readonly string[];
}

/** Prefix of agent tokens, so they are recognisable in configs and secret scanners. */
export const AGENT_TOKEN_PREFIX = 'opsis_';
/** `opsis_` + 43 base64url characters (32 random bytes). */
export const AGENT_TOKEN_PATTERN = /^opsis_[A-Za-z0-9_-]{43}$/;

const AgentNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} ._@-]*$/u, 'letters, digits, space, . _ @ -');

export const CreateAgentInputSchema = z.strictObject({
  name: AgentNameSchema,
  projectIds: z.array(z.string().regex(ID_PATTERN)).max(1000).default([]),
});
export type CreateAgentInput = z.input<typeof CreateAgentInputSchema>;

export const AgentGrantInputSchema = z.strictObject({ projectId: z.string().regex(ID_PATTERN) });
export type AgentGrantInput = z.input<typeof AgentGrantInputSchema>;
