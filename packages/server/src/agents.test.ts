import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AGENT_TOKEN_PATTERN,
  LOCAL_HUMAN,
  OpsisError,
  authenticateAgent,
  cancelSession,
  changeDraft,
  compareUiVersions,
  createAgent,
  createProject,
  createUiView,
  exportVersion,
  getImplementationPrompt,
  getProject,
  getScreenshot,
  getSession,
  getSpecification,
  getUiVersion,
  getUiView,
  grantAgentProject,
  listAgents,
  listProjects,
  listScreenshots,
  listSessions,
  listUiViews,
  newId,
  releaseSpecification,
  revokeAgent,
  revokeAgentProject,
  submitScreenshot,
  type Actor,
  type ErrorCode,
} from '@opsis/core';
import { runAgentCommand, type CliIo } from './agent-command.js';
import { errorHandler } from './http/errors.js';
import { requireAgent } from './http/agent-auth.js';
import { nodeHasher } from './infrastructure/hash.js';
import { createTestEnv, makeImage, type TestEnv } from './testing/support.js';

let env: TestEnv;
beforeEach(() => {
  env = createTestEnv();
});
afterEach(() => {
  env.cleanup();
});

const codeOf = (work: () => unknown): ErrorCode | undefined => {
  try {
    work();
  } catch (error) {
    if (error instanceof OpsisError) return error.code;
    throw error;
  }
  return undefined;
};

const asyncCodeOf = async (work: () => Promise<unknown>): Promise<ErrorCode | undefined> => {
  try {
    await work();
  } catch (error) {
    if (error instanceof OpsisError) return error.code;
    throw error;
  }
  return undefined;
};

describe('agent management', () => {
  it('creates an agent with a one-time token of which only the hash is stored', () => {
    const projectId = createProject(env.ctx, LOCAL_HUMAN, { name: 'Shop' }).id;
    const { agent, token } = createAgent(env.ctx, LOCAL_HUMAN, {
      name: 'claude-code laptop',
      projectIds: [projectId],
    });
    expect(token).toMatch(AGENT_TOKEN_PATTERN);
    expect(agent).toMatchObject({ name: 'claude-code laptop', revokedAt: null, projectIds: [projectId] });

    const row = env.db.get('SELECT * FROM agents WHERE id = :id', { id: agent.id });
    expect(row?.['token_hash']).toBe(nodeHasher.sha256(token));
    expect(JSON.stringify(row)).not.toContain(token);
    const audit = env.db.get("SELECT data FROM audit_log WHERE entity_type = 'agent' AND action = 'create'");
    expect(String(audit?.['data'])).not.toContain(token);
    expect(env.events).toContainEqual({ type: 'AgentChanged', agentId: agent.id });

    const second = createAgent(env.ctx, LOCAL_HUMAN, { name: 'other' });
    expect(second.token).not.toBe(token);
    expect(listAgents(env.ctx, LOCAL_HUMAN).map((a) => a.name)).toEqual(['claude-code laptop', 'other']);
  });

  it('validates names and projects and leaves management to the human', () => {
    expect(codeOf(() => createAgent(env.ctx, LOCAL_HUMAN, { name: '  ' }))).toBe('VALIDATION');
    expect(codeOf(() => createAgent(env.ctx, LOCAL_HUMAN, { name: '<script>' }))).toBe('VALIDATION');
    expect(
      codeOf(() => createAgent(env.ctx, LOCAL_HUMAN, { name: 'a', projectIds: [newId('project')] })),
    ).toBe('NOT_FOUND');
    const agent: Actor = { type: 'agent', id: newId('agent'), name: 'x' };
    expect(codeOf(() => createAgent(env.ctx, agent, { name: 'evil' }))).toBe('FORBIDDEN_ACTOR');
    expect(codeOf(() => listAgents(env.ctx, agent))).toBe('FORBIDDEN_ACTOR');
  });

  it('authenticates valid tokens only, and not after revocation', () => {
    const { agent, token } = createAgent(env.ctx, LOCAL_HUMAN, { name: 'a' });
    expect(authenticateAgent(env.ctx, token)).toEqual({ type: 'agent', id: agent.id, name: 'a' });
    expect(
      authenticateAgent(env.ctx, `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`),
    ).toBeUndefined();
    expect(authenticateAgent(env.ctx, 'opsis_short')).toBeUndefined();
    expect(authenticateAgent(env.ctx, '')).toBeUndefined();

    const revoked = revokeAgent(env.ctx, LOCAL_HUMAN, agent.id);
    expect(revoked.revokedAt).not.toBeNull();
    expect(authenticateAgent(env.ctx, token)).toBeUndefined();
    // Idempotent; a revoked agent cannot get new grants.
    expect(revokeAgent(env.ctx, LOCAL_HUMAN, agent.id).revokedAt).toBe(revoked.revokedAt);
    const projectId = createProject(env.ctx, LOCAL_HUMAN, { name: 'Shop' }).id;
    expect(codeOf(() => grantAgentProject(env.ctx, LOCAL_HUMAN, agent.id, { projectId }))).toBe('CONFLICT');
  });

  it('grants and withdraws project access', () => {
    const projectId = createProject(env.ctx, LOCAL_HUMAN, { name: 'Shop' }).id;
    const { agent, token } = createAgent(env.ctx, LOCAL_HUMAN, { name: 'a' });
    const actor = authenticateAgent(env.ctx, token);
    if (!actor) throw new Error('not authenticated');
    expect(listProjects(env.ctx, actor)).toEqual([]);
    expect(codeOf(() => getProject(env.ctx, actor, projectId))).toBe('NOT_FOUND');

    expect(grantAgentProject(env.ctx, LOCAL_HUMAN, agent.id, { projectId }).projectIds).toEqual([projectId]);
    expect(getProject(env.ctx, actor, projectId).id).toBe(projectId);
    expect(revokeAgentProject(env.ctx, LOCAL_HUMAN, agent.id, { projectId }).projectIds).toEqual([]);
    expect(codeOf(() => getProject(env.ctx, actor, projectId))).toBe('NOT_FOUND');
    expect(
      env.db
        .all("SELECT action FROM audit_log WHERE entity_type = 'agent' ORDER BY rowid")
        .map((r) => r['action']),
    ).toEqual(['create', 'grant', 'revoke_grant']);
  });
});

describe('access of an agent to a foreign project', () => {
  it('answers every read and write with NOT_FOUND', async () => {
    // A project with a released version, a session and a screenshot – not granted.
    const foreign = createProject(env.ctx, LOCAL_HUMAN, { name: 'Foreign' }).id;
    const submitted = await submitScreenshot(
      env.ctx,
      LOCAL_HUMAN,
      { projectId: foreign, source: 'upload', uiPath: '/secret', metadata: {} },
      await makeImage(),
    );
    const sessionId = submitted.session.id;
    const screenshotId = submitted.screenshot.id;
    const componentId = newId('component');
    changeDraft(env.ctx, LOCAL_HUMAN, sessionId, {
      baseRevision: 0,
      operations: [
        {
          op: 'addComponent',
          componentId,
          parentId: null,
          name: 'Box',
          kind: 'container',
          region: { screenshotId, x: 1, y: 1, width: 50, height: 50 },
        },
      ],
    });
    const versionId = releaseSpecification(env.ctx, LOCAL_HUMAN, sessionId, {
      rowVersion: getSession(env.ctx, LOCAL_HUMAN, sessionId).session.rowVersion,
      acknowledgedWarnings: [`missing_description:${componentId}`, `missing_acceptance:${componentId}`],
    }).uiVersion.id;

    const { token } = createAgent(env.ctx, LOCAL_HUMAN, { name: 'a' });
    const agent = authenticateAgent(env.ctx, token);
    if (!agent) throw new Error('not authenticated');
    const uiId = submitted.uiView.uiId;

    const sync: [string, () => unknown][] = [
      ['getProject', () => getProject(env.ctx, agent, foreign)],
      ['listUiViews', () => listUiViews(env.ctx, agent, foreign)],
      ['getUiView', () => getUiView(env.ctx, agent, foreign, uiId)],
      ['createUiView', () => createUiView(env.ctx, agent, foreign, { path: '/x' })],
      ['listSessions', () => listSessions(env.ctx, agent, { projectId: foreign })],
      ['getSession', () => getSession(env.ctx, agent, sessionId)],
      ['cancelSession', () => cancelSession(env.ctx, agent, sessionId, 'x')],
      ['listScreenshots', () => listScreenshots(env.ctx, agent, { projectId: foreign })],
      ['getScreenshot', () => getScreenshot(env.ctx, agent, screenshotId)],
      ['getUiVersion', () => getUiVersion(env.ctx, agent, versionId)],
      ['compareUiVersions', () => compareUiVersions(env.ctx, agent, versionId, versionId)],
      ['getSpecification (session)', () => getSpecification(env.ctx, agent, { sessionId }, 'json')],
      ['getSpecification (version)', () => getSpecification(env.ctx, agent, { versionId }, 'markdown')],
      ['getImplementationPrompt', () => getImplementationPrompt(env.ctx, agent, { sessionId })],
    ];
    for (const [name, call] of sync) expect([name, codeOf(call)]).toEqual([name, 'NOT_FOUND']);

    const async: [string, () => Promise<unknown>][] = [
      ['exportVersion', () => exportVersion(env.ctx, agent, versionId, { kind: 'json' })],
      [
        'submitScreenshot',
        async () =>
          submitScreenshot(
            env.ctx,
            agent,
            { projectId: foreign, source: 'mcp', uiPath: '/x', metadata: {} },
            await makeImage(),
          ),
      ],
      [
        'submitScreenshot (to foreign session)',
        async () => {
          const own = createProject(env.ctx, agent, { name: 'Own' }).id;
          return submitScreenshot(
            env.ctx,
            agent,
            { projectId: own, source: 'mcp', uiPath: '/x', sessionId, metadata: {} },
            await makeImage(),
          );
        },
      ],
    ];
    for (const [name, call] of async) expect([name, await asyncCodeOf(call)]).toEqual([name, 'NOT_FOUND']);

    // Nothing was delivered or changed by the attempts.
    expect(getSession(env.ctx, LOCAL_HUMAN, sessionId).session.status).toBe('ready');
    expect(listProjects(env.ctx, agent).map((p) => p.name)).toEqual(['Own']);
  });
});

describe('bearer authentication', () => {
  const buildProbe = async () => {
    const app = Fastify();
    app.setErrorHandler(errorHandler);
    app.get('/probe', (request) => requireAgent(env.ctx, request));
    await app.ready();
    return app;
  };

  it('accepts a valid token and rejects everything else uniformly with 401', async () => {
    const app = await buildProbe();
    const { agent, token } = createAgent(env.ctx, LOCAL_HUMAN, { name: 'a' });
    const probe = (authorization?: string) =>
      app.inject({ method: 'GET', url: '/probe', headers: authorization ? { authorization } : {} });

    const ok = await probe(`Bearer ${token}`);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ type: 'agent', id: agent.id, name: 'a' });

    const failures = [undefined, token, `Basic ${token}`, `Bearer ${token} x`, 'Bearer opsis_wrong'];
    revokeAgent(env.ctx, LOCAL_HUMAN, agent.id);
    failures.push(`Bearer ${token}`);
    for (const header of failures) {
      const response = await probe(header);
      expect(response.statusCode).toBe(401);
      expect(response.headers['www-authenticate']).toBe('Bearer');
      expect(response.json()).toEqual({
        error: { code: 'UNAUTHENTICATED', message: 'Missing or invalid agent token' },
      });
    }
    await app.close();
  });
});

describe('opsis agent CLI', () => {
  const run = (args: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const io: CliIo = { out: (line) => out.push(line), err: (line) => err.push(line) };
    const code = runAgentCommand(env.ctx, args, io, 'http://127.0.0.1:4777/mcp');
    return { code, out: out.join('\n'), err: err.join('\n') };
  };

  it('creates, lists, grants and revokes agents', () => {
    createProject(env.ctx, LOCAL_HUMAN, { name: 'Shop', slug: 'shop' });
    const created = run(['create', '--name', 'laptop', '--project', 'shop']);
    expect(created.code).toBe(0);
    const token = /Token \(shown only once\): (\S+)/.exec(created.out)?.[1] ?? '';
    expect(token).toMatch(AGENT_TOKEN_PATTERN);
    expect(created.out).toContain('"url": "http://127.0.0.1:4777/mcp"');
    expect(created.out).toContain('projects: shop');
    const agentId = /^(agt_\S+)/.exec(created.out)?.[1] ?? '';

    expect(run(['ungrant', agentId, 'shop']).out).toContain('projects: –');
    expect(run(['grant', agentId, 'shop']).out).toContain('projects: shop');
    expect(run(['list']).out).toContain(`${agentId}  laptop  [active]`);
    expect(run(['revoke', agentId]).out).toContain('[revoked');
    expect(authenticateAgent(env.ctx, token)).toBeUndefined();
  });

  it('prints the usage for unknown or incomplete commands', () => {
    for (const args of [[], ['create'], ['revoke'], ['grant', 'x'], ['frobnicate']]) {
      const result = run(args);
      expect(result.code).toBe(2);
      expect(result.err).toContain('Usage:');
    }
  });
});
