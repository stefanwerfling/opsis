/**
 * MCP resources (architecture 06 §4). Every read goes through the same use cases and the
 * same AccessPolicy as the tools; listings only contain what the agent may see.
 */
import {
  ProtocolError,
  ProtocolErrorCode,
  ResourceNotFoundError,
  ResourceTemplate,
  type McpServer,
  type ReadResourceResult,
} from '@modelcontextprotocol/server';
import {
  OpsisError,
  SESSION_STATUSES,
  findUiView,
  getImplementationPrompt,
  getProject,
  getSession,
  getSpecification,
  getUiVersion,
  getUiView,
  isOpsisError,
  isTerminal,
  listProjects,
  listSessions,
  listUiVersions,
  listUiViews,
  readScreenshotImage,
  type Actor,
  type AppContext,
} from '@opsis/core';
import {
  nextAction,
  presentProject,
  presentSession,
  presentUiView,
  presentVersion,
  type PresenterContext,
} from './presenters.js';

const JSON_MIME = 'application/json';

/** URIs of the resources, also used for `notifications/resources/updated`. */
export const resourceUri = {
  project: (projectId: string) => `opsis://projects/${projectId}`,
  uiView: (projectId: string, uiId: string) => `opsis://projects/${projectId}/ui/${uiId}`,
  uiHistory: (projectId: string, uiId: string) => `opsis://projects/${projectId}/ui/${uiId}/history`,
  version: (projectId: string, uiId: string, versionNo: number) =>
    `opsis://projects/${projectId}/ui/${uiId}/versions/${String(versionNo)}`,
  session: (sessionId: string) => `opsis://sessions/${sessionId}`,
  specification: (sessionId: string) => `opsis://sessions/${sessionId}/specification`,
  prompt: (sessionId: string) => `opsis://sessions/${sessionId}/prompt`,
  screenshot: (screenshotId: string) => `opsis://screenshots/${screenshotId}`,
};

const variable = (variables: Record<string, string | string[]>, name: string): string => {
  const value = variables[name];
  const text = Array.isArray(value) ? value[0] : value;
  if (text === undefined || text === '' || text.length > 200)
    throw new OpsisError('VALIDATION', `invalid ${name}`);
  return decodeURIComponent(text);
};

const json = (uri: URL, data: unknown): ReadResourceResult => ({
  contents: [{ uri: uri.href, mimeType: JSON_MIME, text: JSON.stringify(data, null, 2) }],
});

/** Domain errors as JSON-RPC errors; unknown or foreign ids are "resource not found". */
const toProtocolError = (uri: URL, error: OpsisError): ProtocolError => {
  if (error.code === 'NOT_FOUND') return new ResourceNotFoundError(uri.href, error.message);
  const code =
    error.code === 'VALIDATION' ? ProtocolErrorCode.InvalidParams : ProtocolErrorCode.InvalidRequest;
  return new ProtocolError(code, `${error.code}: ${error.message}`, {
    code: error.code,
    ...(error.details ?? {}),
  });
};

type InternalErrorSink = ((error: unknown, uri: string) => void) | undefined;

const guardWith =
  (onInternalError: InternalErrorSink) =>
  <A extends unknown[]>(read: (uri: URL, ...args: A) => ReadResourceResult | Promise<ReadResourceResult>) =>
  async (uri: URL, ...args: A): Promise<ReadResourceResult> => {
    try {
      return await read(uri, ...args);
    } catch (error) {
      if (isOpsisError(error)) throw toProtocolError(uri, error);
      // Internal messages (paths, SQL) must not reach the agent.
      onInternalError?.(error, uri.href);
      throw new ProtocolError(ProtocolErrorCode.InternalError, 'Internal server error');
    }
  };

const openStatuses = SESSION_STATUSES.filter((status) => !isTerminal(status));

export const registerResources = (
  server: McpServer,
  p: PresenterContext,
  actor: Actor,
  onInternalError?: (error: unknown, uri: string) => void,
): void => {
  const ctx: AppContext = p.ctx;
  const guarded = guardWith(onInternalError);
  const guardedList =
    <T>(list: () => T) =>
    (): T => {
      try {
        return list();
      } catch (error) {
        if (isOpsisError(error)) throw toProtocolError(new URL('opsis://'), error);
        onInternalError?.(error, 'resources/list');
        throw new ProtocolError(ProtocolErrorCode.InternalError, 'Internal server error');
      }
    };

  server.registerResource(
    'project',
    new ResourceTemplate('opsis://projects/{project_id}', {
      list: guardedList(() => ({
        resources: listProjects(ctx, actor).map((project) => ({
          uri: resourceUri.project(project.id),
          name: project.name,
          mimeType: JSON_MIME,
        })),
      })),
    }),
    { title: 'Project', description: 'A project the agent has access to.', mimeType: JSON_MIME },
    guarded((uri, variables) =>
      json(uri, { project: presentProject(getProject(ctx, actor, variable(variables, 'project_id'))) }),
    ),
  );

  server.registerResource(
    'ui-view',
    new ResourceTemplate('opsis://projects/{project_id}/ui/{ui_id}', {
      list: guardedList(() => ({
        resources: listProjects(ctx, actor).flatMap((project) =>
          listUiViews(ctx, actor, project.id).map((view) => ({
            uri: resourceUri.uiView(project.id, view.uiId),
            name: `${project.name}: ${view.name} (${view.uiId})`,
            mimeType: JSON_MIME,
          })),
        ),
      })),
    }),
    { title: 'UI view', description: 'A UI view with its path history.', mimeType: JSON_MIME },
    guarded((uri, variables) => {
      const details = getUiView(ctx, actor, variable(variables, 'project_id'), variable(variables, 'ui_id'));
      return json(uri, {
        ui_view: presentUiView(ctx, details.view),
        path_history: details.pathHistory.map((change) => ({
          old_path: change.oldPath,
          new_path: change.newPath,
          changed_at: change.changedAt,
        })),
      });
    }),
  );

  server.registerResource(
    'ui-history',
    new ResourceTemplate('opsis://projects/{project_id}/ui/{ui_id}/history', { list: undefined }),
    { title: 'UI history', description: 'All released versions of a UI view.', mimeType: JSON_MIME },
    guarded((uri, variables) => {
      const view = findUiView(ctx, actor, variable(variables, 'project_id'), variable(variables, 'ui_id'));
      return json(uri, {
        ui_id: view.uiId,
        versions: listUiVersions(ctx, actor, view.id).map(presentVersion),
      });
    }),
  );

  server.registerResource(
    'ui-version',
    new ResourceTemplate('opsis://projects/{project_id}/ui/{ui_id}/versions/{version_no}', {
      list: undefined,
    }),
    {
      title: 'UI version',
      description: 'Complete historical reconstruction of one released version (specification JSON).',
      mimeType: JSON_MIME,
    },
    guarded((uri, variables) => {
      const view = findUiView(ctx, actor, variable(variables, 'project_id'), variable(variables, 'ui_id'));
      const versionNo = Number(variable(variables, 'version_no'));
      const version = Number.isInteger(versionNo)
        ? ctx.repos.versions.findUiVersionByNo(view.id, versionNo)
        : undefined;
      if (!version)
        throw new OpsisError('NOT_FOUND', `version ${variable(variables, 'version_no')} not found`);
      const released = getUiVersion(ctx, actor, version.id);
      return json(uri, {
        version: presentVersion(released.uiVersion),
        specification: getSpecification(ctx, actor, { versionId: version.id }, 'json').content,
      });
    }),
  );

  server.registerResource(
    'session',
    new ResourceTemplate('opsis://sessions/{session_id}', {
      list: guardedList(() => ({
        resources: listProjects(ctx, actor).flatMap((project) =>
          listSessions(ctx, actor, { projectId: project.id, statuses: openStatuses }).map((session) => ({
            uri: resourceUri.session(session.id),
            name: `${project.name}: ${session.title}`,
            mimeType: JSON_MIME,
          })),
        ),
      })),
    }),
    {
      title: 'Session',
      description: 'A session and its status (open sessions are listed).',
      mimeType: JSON_MIME,
    },
    guarded((uri, variables) => {
      const details = getSession(ctx, actor, variable(variables, 'session_id'));
      return json(uri, {
        session: presentSession(p, details.session),
        next_action: nextAction(details.session.status),
      });
    }),
  );

  server.registerResource(
    'specification',
    new ResourceTemplate('opsis://sessions/{session_id}/specification', { list: undefined }),
    {
      title: 'Specification',
      description: 'The released specification (from status ready).',
      mimeType: JSON_MIME,
    },
    guarded((uri, variables) =>
      json(
        uri,
        getSpecification(ctx, actor, { sessionId: variable(variables, 'session_id') }, 'json').content,
      ),
    ),
  );

  server.registerResource(
    'prompt',
    new ResourceTemplate('opsis://sessions/{session_id}/prompt', { list: undefined }),
    {
      title: 'Implementation prompt',
      description: 'The implementation prompt (from status ready). Reading it counts as delivery.',
      mimeType: 'text/markdown',
    },
    guarded((uri, variables) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: getImplementationPrompt(ctx, actor, { sessionId: variable(variables, 'session_id') })
            .markdown,
        },
      ],
    })),
  );

  server.registerResource(
    'screenshot',
    new ResourceTemplate('opsis://screenshots/{screenshot_id}', { list: undefined }),
    { title: 'Screenshot', description: 'The original screenshot image.' },
    guarded(async (uri, variables) => {
      const { screenshot, bytes } = await readScreenshotImage(
        ctx,
        actor,
        variable(variables, 'screenshot_id'),
      );
      return {
        contents: [
          { uri: uri.href, mimeType: screenshot.mimeType, blob: Buffer.from(bytes).toString('base64') },
        ],
      };
    }),
  );
};
