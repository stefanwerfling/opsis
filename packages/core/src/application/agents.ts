/**
 * Agent management (architecture 04 §4): registration with a one-time token, revocation
 * and project grants. Only the human manages agents; agents never see other agents.
 */
import {
  AGENT_TOKEN_PATTERN,
  AGENT_TOKEN_PREFIX,
  AgentGrantInputSchema,
  CreateAgentInputSchema,
} from '../domain/agent.js';
import type { Agent, AgentWithGrants } from '../domain/agent.js';
import type { Actor } from '../domain/actor.js';
import { OpsisError } from '../domain/errors.js';
import { newId } from '../domain/ids.js';
import { randomToken } from '../domain/token.js';
import { commit, parseInput, type AppContext } from './context.js';

const assertHuman = (actor: Actor): void => {
  if (actor.type !== 'human') throw new OpsisError('FORBIDDEN_ACTOR', 'Only a human can manage agents');
};

const withGrants = (ctx: AppContext, agent: Agent): AgentWithGrants => ({
  ...agent,
  projectIds: ctx.repos.grants.listProjectIds(agent.id),
});

const findAgent = (ctx: AppContext, agentId: string): Agent => {
  const agent = ctx.repos.agents.findById(agentId);
  if (!agent) throw new OpsisError('NOT_FOUND', `agent "${agentId}" not found`);
  return agent;
};

const findProject = (ctx: AppContext, projectId: string): void => {
  if (!ctx.repos.projects.findById(projectId)) {
    throw new OpsisError('NOT_FOUND', `project "${projectId}" not found`);
  }
};

export interface CreatedAgent {
  readonly agent: AgentWithGrants;
  /** Shown exactly once; only its hash is stored. */
  readonly token: string;
}

export const createAgent = (ctx: AppContext, actor: Actor, input: unknown): CreatedAgent => {
  assertHuman(actor);
  const data = parseInput(CreateAgentInputSchema, input);
  return commit(ctx, actor, (uow) => {
    for (const projectId of data.projectIds) findProject(ctx, projectId);
    const agent: Agent = { id: newId('agent'), name: data.name, createdAt: uow.now, revokedAt: null };
    const token = randomToken(AGENT_TOKEN_PREFIX);
    ctx.repos.agents.insert(agent, ctx.hash.sha256(token));
    for (const projectId of new Set(data.projectIds)) ctx.repos.grants.grant(agent.id, projectId, uow.now);
    uow.audit({
      projectId: null,
      entityType: 'agent',
      entityId: agent.id,
      action: 'create',
      data: { name: agent.name, projectIds: data.projectIds },
    });
    uow.emit({ type: 'AgentChanged', agentId: agent.id });
    return { agent: withGrants(ctx, agent), token };
  });
};

export const listAgents = (ctx: AppContext, actor: Actor): AgentWithGrants[] => {
  assertHuman(actor);
  return ctx.repos.agents.list().map((agent) => withGrants(ctx, agent));
};

/** Revocation is permanent: the token stops working, history keeps the agent. */
export const revokeAgent = (ctx: AppContext, actor: Actor, agentId: string): AgentWithGrants => {
  assertHuman(actor);
  return commit(ctx, actor, (uow) => {
    const agent = findAgent(ctx, agentId);
    if (agent.revokedAt !== null) return withGrants(ctx, agent);
    ctx.repos.agents.revoke(agent.id, uow.now);
    uow.audit({ projectId: null, entityType: 'agent', entityId: agent.id, action: 'revoke' });
    uow.emit({ type: 'AgentChanged', agentId: agent.id });
    return withGrants(ctx, { ...agent, revokedAt: uow.now });
  });
};

export const grantAgentProject = (
  ctx: AppContext,
  actor: Actor,
  agentId: string,
  input: unknown,
): AgentWithGrants => {
  assertHuman(actor);
  const { projectId } = parseInput(AgentGrantInputSchema, input);
  return commit(ctx, actor, (uow) => {
    const agent = findAgent(ctx, agentId);
    if (agent.revokedAt !== null) throw new OpsisError('CONFLICT', `agent "${agentId}" is revoked`);
    findProject(ctx, projectId);
    if (!ctx.repos.grants.hasGrant(agent.id, projectId)) {
      ctx.repos.grants.grant(agent.id, projectId, uow.now);
      uow.audit({ projectId, entityType: 'agent', entityId: agent.id, action: 'grant' });
      uow.emit({ type: 'AgentChanged', agentId: agent.id });
    }
    return withGrants(ctx, agent);
  });
};

export const revokeAgentProject = (
  ctx: AppContext,
  actor: Actor,
  agentId: string,
  input: unknown,
): AgentWithGrants => {
  assertHuman(actor);
  const { projectId } = parseInput(AgentGrantInputSchema, input);
  return commit(ctx, actor, (uow) => {
    const agent = findAgent(ctx, agentId);
    if (ctx.repos.grants.revoke(agent.id, projectId)) {
      uow.audit({ projectId, entityType: 'agent', entityId: agent.id, action: 'revoke_grant' });
      uow.emit({ type: 'AgentChanged', agentId: agent.id });
    }
    return withGrants(ctx, agent);
  });
};

/**
 * Resolves a bearer token to its agent. Unknown, malformed and revoked tokens all yield
 * `undefined` – the caller answers uniformly with 401.
 */
export const authenticateAgent = (ctx: AppContext, token: string): Actor | undefined => {
  if (!AGENT_TOKEN_PATTERN.test(token)) return undefined;
  const agent = ctx.repos.agents.findByTokenHash(ctx.hash.sha256(token));
  if (!agent || agent.revokedAt !== null) return undefined;
  return { type: 'agent', id: agent.id, name: agent.name };
};
