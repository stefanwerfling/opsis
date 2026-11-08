import { parseArgs } from 'node:util';
import {
  LOCAL_HUMAN,
  OpsisError,
  createAgent,
  grantAgentProject,
  listAgents,
  revokeAgent,
  revokeAgentProject,
  type AppContext,
} from '@opsis/core';

export const USAGE = `Usage:
  opsis [serve]                              start the server
  opsis agent create --name <name> [--project <id|slug>]...
  opsis agent list
  opsis agent revoke <agent-id>
  opsis agent grant <agent-id> <project-id|slug>
  opsis agent ungrant <agent-id> <project-id|slug>

Environment: OPSIS_DATA_DIR (default ./data), OPSIS_HOST, OPSIS_PORT.`;

export interface CliIo {
  out(line: string): void;
  err(line: string): void;
}

/** Accepts a project id or slug. */
const projectId = (ctx: AppContext, ref: string): string => {
  const project = ctx.repos.projects.findById(ref) ?? ctx.repos.projects.findBySlug(ref);
  if (!project) throw new OpsisError('NOT_FOUND', `project "${ref}" not found`);
  return project.id;
};

const describeAgent = (ctx: AppContext, agent: ReturnType<typeof listAgents>[number]): string => {
  const slugs = agent.projectIds.map((id) => ctx.repos.projects.findById(id)?.slug ?? id);
  const state = agent.revokedAt === null ? 'active' : `revoked ${agent.revokedAt}`;
  return `${agent.id}  ${agent.name}  [${state}]  projects: ${slugs.length > 0 ? slugs.join(', ') : '–'}`;
};

/** Agent management on the database (architecture 04 §4). Returns the exit code. */
export const runAgentCommand = (
  ctx: AppContext,
  args: readonly string[],
  io: CliIo,
  mcpUrl: string,
): number => {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: { name: { type: 'string' }, project: { type: 'string', multiple: true } },
  });
  const [command, ...rest] = positionals;
  switch (command) {
    case 'create': {
      if (values.name === undefined || rest.length > 0) break;
      const projectIds = (values.project ?? []).map((ref) => projectId(ctx, ref));
      const { agent, token } = createAgent(ctx, LOCAL_HUMAN, { name: values.name, projectIds });
      io.out(describeAgent(ctx, agent));
      io.out('');
      io.out(`Token (shown only once): ${token}`);
      io.out('');
      io.out('Claude Code (.mcp.json):');
      io.out(
        JSON.stringify(
          {
            mcpServers: {
              opsis: { type: 'http', url: mcpUrl, headers: { Authorization: 'Bearer ${OPSIS_TOKEN}' } },
            },
          },
          null,
          2,
        ),
      );
      return 0;
    }
    case 'list': {
      if (rest.length > 0) break;
      const agents = listAgents(ctx, LOCAL_HUMAN);
      if (agents.length === 0) io.out('No agents.');
      for (const agent of agents) io.out(describeAgent(ctx, agent));
      return 0;
    }
    case 'revoke': {
      const [agentId] = rest;
      if (agentId === undefined || rest.length !== 1) break;
      io.out(describeAgent(ctx, revokeAgent(ctx, LOCAL_HUMAN, agentId)));
      return 0;
    }
    case 'grant':
    case 'ungrant': {
      const [agentId, project] = rest;
      if (agentId === undefined || project === undefined || rest.length !== 2) break;
      const change = command === 'grant' ? grantAgentProject : revokeAgentProject;
      io.out(describeAgent(ctx, change(ctx, LOCAL_HUMAN, agentId, { projectId: projectId(ctx, project) })));
      return 0;
    }
  }
  io.err(USAGE);
  return 2;
};
