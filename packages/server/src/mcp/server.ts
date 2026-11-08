/**
 * MCP server factory (architecture 06): one McpServer per request, bound to the
 * authenticated agent. Tools are thin adapters – every check (access, transitions,
 * validation) happens in the application layer, exactly as for REST.
 */
import {
  McpServer,
  type CallToolResult,
  type ContentBlock,
  type ServerContext,
  type ToolCallback,
} from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  DEVICE_CATEGORIES,
  IMAGE_LIMITS,
  IMAGE_MIME_TYPES,
  OpsisError,
  SESSION_STATUSES,
  UiIdSchema,
  UiPathSchema,
  cancelSession,
  createProject,
  createUiView,
  findUiView,
  getImplementationPrompt,
  getProject,
  getScreenshot,
  getSession,
  getSpecification,
  getUiView,
  isOpsisError,
  isTerminal,
  listProjects,
  listScreenshots,
  listSessions,
  listUiVersions,
  listUiViews,
  readScreenshotImage,
  submitScreenshot,
  updateProject,
  WAIT_LIMITS,
  waitForSpecification,
  type Actor,
  type Metadata,
} from '@opsis/core';
import { registerResources } from './resources.js';
import {
  nextAction,
  presentProject,
  presentScreenshot,
  presentSession,
  presentUiView,
  presentVersion,
  type PresenterContext,
} from './presenters.js';

export const MCP_SERVER_INFO = { name: 'opsis', version: '0.1.0' } as const;

/** Longer edge of screenshot thumbnails handed to agents (vision models scale down anyway). */
export const THUMBNAIL_EDGE = 1568;
const PAGE_SIZE = 100;

// ── Shared schemas ────────────────────────────────────────────────────────────

const Id = z.string().min(1).max(64);
const ProjectId = Id.describe('Project id (prj_…)');
const SessionId = Id.describe('Session id (ses_…)');
const UiId = UiIdSchema.describe('Stable UI-ID of a UI view, e.g. "ui-dashboard"');

const ProjectOut = z.looseObject({ project_id: z.string(), slug: z.string(), name: z.string() });
const UiViewOut = z.looseObject({
  ui_id: z.string(),
  path: z.string(),
  head_version_no: z.number().nullable(),
});
const SessionOut = z.looseObject({
  session_id: z.string(),
  status: z.enum(SESSION_STATUSES),
  editor_url: z.string(),
});
const ScreenshotOut = z.looseObject({
  screenshot_id: z.string(),
  ui_id: z.string(),
  sequence_no: z.number(),
});
const VersionOut = z.looseObject({ version_id: z.string(), version_no: z.number() });

/** Base64 without whitespace; the decoded size is checked before decoding. */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const maxBase64Length = Math.ceil(IMAGE_LIMITS.maxBytes / 3) * 4;

const decodeImage = (base64: string): Uint8Array => {
  if (base64.length > maxBase64Length) {
    throw new OpsisError('PAYLOAD_TOO_LARGE', `Image exceeds ${String(IMAGE_LIMITS.maxBytes)} bytes`, {
      maxBytes: IMAGE_LIMITS.maxBytes,
    });
  }
  if (base64.length % 4 !== 0 || !BASE64.test(base64)) {
    throw new OpsisError('VALIDATION', 'image_base64 is not valid base64 (no data: prefix, no line breaks)');
  }
  const buffer = Buffer.from(base64, 'base64');
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
};

const pageOf = <T>(items: readonly T[], cursor: string | undefined) => {
  const offset = cursor === undefined ? 0 : Number.parseInt(Buffer.from(cursor, 'base64url').toString(), 10);
  if (!Number.isInteger(offset) || offset < 0) throw new OpsisError('VALIDATION', 'Invalid cursor');
  const page = items.slice(offset, offset + PAGE_SIZE);
  const next =
    offset + PAGE_SIZE < items.length
      ? Buffer.from(String(offset + PAGE_SIZE)).toString('base64url')
      : undefined;
  return { page, next };
};

// ── Registration helper ───────────────────────────────────────────────────────

interface ToolOutcome {
  readonly data: Record<string, unknown>;
  /** Short human-readable summary, first content block. */
  readonly text: string;
  readonly extra?: ContentBlock[];
}

interface ToolDefinition<I extends z.ZodObject> {
  readonly title: string;
  readonly description: string;
  readonly input: I;
  readonly output: z.ZodType;
  readonly readOnly: boolean;
  readonly idempotent?: boolean;
  readonly destructive?: boolean;
}

/** Domain errors become `isError` results with a machine-readable code (06 §3). */
export const errorResult = (error: OpsisError): CallToolResult => {
  const body = {
    error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
  };
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(body) }] };
};

const register = <I extends z.ZodObject>(
  server: McpServer,
  name: string,
  definition: ToolDefinition<I>,
  run: (args: z.output<I>, extra: ServerContext) => ToolOutcome | Promise<ToolOutcome>,
): void => {
  server.registerTool(
    name,
    {
      title: definition.title,
      description: definition.description,
      inputSchema: definition.input,
      outputSchema: definition.output,
      annotations: {
        title: definition.title,
        readOnlyHint: definition.readOnly,
        idempotentHint: definition.idempotent ?? definition.readOnly,
        destructiveHint: definition.destructive ?? false,
        openWorldHint: false,
      },
    },
    // The SDK infers the arguments via Standard Schema; for a zod object that is z.output<I>.
    (async (args: unknown, extra: ServerContext): Promise<CallToolResult> => {
      try {
        const outcome = await run(args as z.output<I>, extra);
        return {
          content: [{ type: 'text', text: outcome.text }, ...(outcome.extra ?? [])],
          structuredContent: outcome.data,
        };
      } catch (error) {
        if (isOpsisError(error)) return errorResult(error);
        throw error;
      }
    }) as ToolCallback<I>,
  );
};

// ── Factory ───────────────────────────────────────────────────────────────────

export interface McpServerOptions extends PresenterContext {
  /** Timings of opsis_wait_for_specification (tests shorten them). */
  readonly wait?: { readonly pollMs?: number; readonly progressMs?: number };
  /** Aborted when the caller cancels or disconnects (see InflightCalls in route.ts). */
  readonly signal?: AbortSignal;
  /**
   * Resource subscriptions need a long-lived stream: only 2026-07-28 clients have one
   * (`subscriptions/listen`); the stateless 2025 fallback cannot deliver updates.
   */
  readonly subscriptions?: boolean;
}

export const createOpsisMcpServer = (p: McpServerOptions, actor: Actor): McpServer => {
  const { ctx } = p;
  const server = new McpServer(MCP_SERVER_INFO, {
    capabilities: { resources: { subscribe: p.subscriptions === true, listChanged: false } },
    instructions:
      'OPSIS turns screenshots into human-approved UI specifications. Submit a screenshot ' +
      '(opsis_submit_screenshot), give the editor_url to the human, wait with ' +
      'opsis_wait_for_specification, then fetch opsis_get_implementation_prompt and implement it. ' +
      'Agents cannot edit or release specifications.',
  });

  // ── Projects ──
  register(
    server,
    'opsis_list_projects',
    {
      title: 'List projects',
      description: 'Projects this agent has been granted access to.',
      input: z.object({ cursor: z.string().max(100).optional() }),
      output: z.object({ projects: z.array(ProjectOut), next_cursor: z.string().optional() }),
      readOnly: true,
    },
    ({ cursor }) => {
      const { page, next } = pageOf(listProjects(ctx, actor), cursor);
      return {
        data: { projects: page.map(presentProject), ...(next === undefined ? {} : { next_cursor: next }) },
        text:
          page.length === 0
            ? 'No projects.'
            : page.map((project) => `${project.id} ${project.name}`).join('\n'),
      };
    },
  );

  register(
    server,
    'opsis_get_project',
    {
      title: 'Get project',
      description: 'A project with the number of UI views and open sessions.',
      input: z.object({ project_id: ProjectId }),
      output: z.object({ project: ProjectOut, ui_view_count: z.number(), open_session_count: z.number() }),
      readOnly: true,
    },
    ({ project_id }) => {
      const project = getProject(ctx, actor, project_id);
      const uiViews = listUiViews(ctx, actor, project_id).length;
      const open = listSessions(ctx, actor, {
        projectId: project_id,
        statuses: SESSION_STATUSES.filter((status) => !isTerminal(status)),
      }).length;
      return {
        data: { project: presentProject(project), ui_view_count: uiViews, open_session_count: open },
        text: `${project.name}: ${String(uiViews)} UI views, ${String(open)} open sessions`,
      };
    },
  );

  register(
    server,
    'opsis_create_project',
    {
      title: 'Create project',
      description: 'Creates a project; the calling agent is granted access to it.',
      input: z.object({
        name: z.string().max(200),
        slug: z.string().max(64).optional(),
        description: z.string().max(10_000).optional(),
        prompt_language: z.enum(['en', 'de']).optional().describe('Language of generated prompts'),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
      output: z.object({ project: ProjectOut }),
      readOnly: false,
      idempotent: false,
    },
    (args) => {
      const project = createProject(ctx, actor, {
        name: args.name,
        ...(args.slug === undefined ? {} : { slug: args.slug }),
        ...(args.description === undefined ? {} : { description: args.description }),
        ...(args.prompt_language === undefined ? {} : { promptLanguage: args.prompt_language }),
        ...(args.metadata === undefined ? {} : { metadata: args.metadata as Metadata }),
      });
      return { data: { project: presentProject(project) }, text: `Created ${project.id} (${project.slug})` };
    },
  );

  register(
    server,
    'opsis_update_project',
    {
      title: 'Update project',
      description: 'Changes name, description, prompt language or metadata of a project.',
      input: z.object({
        project_id: ProjectId,
        name: z.string().max(200).optional(),
        description: z.string().max(10_000).optional(),
        prompt_language: z.enum(['en', 'de']).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
      output: z.object({ project: ProjectOut }),
      readOnly: false,
      idempotent: true,
    },
    (args) => {
      const project = updateProject(ctx, actor, args.project_id, {
        ...(args.name === undefined ? {} : { name: args.name }),
        ...(args.description === undefined ? {} : { description: args.description }),
        ...(args.prompt_language === undefined ? {} : { promptLanguage: args.prompt_language }),
        ...(args.metadata === undefined ? {} : { metadata: args.metadata as Metadata }),
      });
      return { data: { project: presentProject(project) }, text: `Updated ${project.id}` };
    },
  );

  // ── UI views ──
  register(
    server,
    'opsis_list_ui_views',
    {
      title: 'List UI views',
      description: 'UI views (screens/pages) of a project with their stable UI-ID and current version.',
      input: z.object({ project_id: ProjectId }),
      output: z.object({ ui_views: z.array(UiViewOut) }),
      readOnly: true,
    },
    ({ project_id }) => {
      const views = listUiViews(ctx, actor, project_id).map((view) => presentUiView(ctx, view));
      return {
        data: { ui_views: views },
        text:
          views.length === 0 ? 'No UI views.' : views.map((view) => `${view.ui_id} ${view.path}`).join('\n'),
      };
    },
  );

  register(
    server,
    'opsis_get_ui_view',
    {
      title: 'Get UI view',
      description: 'Identity, path history, versions (short) and open sessions of a UI view.',
      input: z.object({ project_id: ProjectId, ui_id: UiId }),
      output: z.object({
        ui_view: UiViewOut,
        path_history: z.array(z.looseObject({ new_path: z.string() })),
        versions: z.array(VersionOut),
        open_sessions: z.array(SessionOut),
      }),
      readOnly: true,
    },
    ({ project_id, ui_id }) => {
      const details = getUiView(ctx, actor, project_id, ui_id);
      const versions = listUiVersions(ctx, actor, details.view.id);
      const open = listSessions(ctx, actor, {
        projectId: project_id,
        uiViewId: details.view.id,
        statuses: SESSION_STATUSES.filter((status) => !isTerminal(status)),
      });
      return {
        data: {
          ui_view: presentUiView(ctx, details.view),
          path_history: details.pathHistory.map((change) => ({
            old_path: change.oldPath,
            new_path: change.newPath,
            changed_at: change.changedAt,
          })),
          versions: versions.map((version) => ({
            version_id: version.id,
            version_no: version.versionNo,
            created_at: version.createdAt,
          })),
          open_sessions: open.map((session) => presentSession(p, session)),
        },
        text: `${details.view.uiId} ${details.view.path}: ${String(versions.length)} versions, ${String(open.length)} open sessions`,
      };
    },
  );

  register(
    server,
    'opsis_create_ui_view',
    {
      title: 'Create UI view',
      description:
        'Registers a UI view explicitly. Usually not needed: opsis_submit_screenshot creates it from ui_path.',
      input: z.object({
        project_id: ProjectId,
        ui_id: UiId.optional(),
        path: UiPathSchema.describe('Logical path, e.g. "/admin/users/:id"'),
        name: z.string().max(200).optional(),
        description: z.string().max(10_000).optional(),
      }),
      output: z.object({ ui_view: UiViewOut }),
      readOnly: false,
      idempotent: false,
    },
    (args) => {
      const view = createUiView(ctx, actor, args.project_id, {
        path: args.path,
        ...(args.ui_id === undefined ? {} : { uiId: args.ui_id }),
        ...(args.name === undefined ? {} : { name: args.name }),
        ...(args.description === undefined ? {} : { description: args.description }),
      });
      return { data: { ui_view: presentUiView(ctx, view) }, text: `Created ${view.uiId} ${view.path}` };
    },
  );

  register(
    server,
    'opsis_get_ui_history',
    {
      title: 'Get UI history',
      description: 'All released versions of a UI view with screenshot, revision and prompt references.',
      input: z.object({ project_id: ProjectId, ui_id: UiId }),
      output: z.object({ ui_id: z.string(), versions: z.array(VersionOut) }),
      readOnly: true,
    },
    ({ project_id, ui_id }) => {
      const view = findUiView(ctx, actor, project_id, ui_id);
      const versions = listUiVersions(ctx, actor, view.id).map(presentVersion);
      return {
        data: { ui_id: view.uiId, versions },
        text:
          versions.length === 0
            ? 'No released versions.'
            : versions
                .map((v) => `V${String(v.version_no)} ${v.version_id} ${v.change_description}`)
                .join('\n'),
      };
    },
  );

  // ── Screenshots ──
  register(
    server,
    'opsis_submit_screenshot',
    {
      title: 'Submit screenshot',
      description:
        'Submits a screenshot of a UI for specification by a human. Creates a session (or, with ' +
        'session_id, adds a variant such as the mobile view to an open session). Give the returned ' +
        'editor_url to the human, then call opsis_wait_for_specification.',
      input: z.object({
        project_id: ProjectId,
        ui_path: UiPathSchema.optional().describe('Logical path of the UI, e.g. "/dashboard"'),
        ui_id: UiId.optional().describe(
          'Existing UI view; with an unknown UI-ID a UI view with exactly this id is created',
        ),
        ui_id_hint: UiId.optional().describe('Preferred UI-ID for a new UI view'),
        image_base64: z
          .string()
          .describe('PNG, JPEG or WebP, base64 without data: prefix, max. 20 MB decoded'),
        mime_type: z
          .enum(IMAGE_MIME_TYPES)
          .optional()
          .describe('Informational; the format is determined from the content'),
        viewport_width: z.number().int().min(1).max(100_000).optional(),
        viewport_height: z.number().int().min(1).max(100_000).optional(),
        device_type: z.enum(DEVICE_CATEGORIES).optional(),
        variant_label: z.string().max(100).optional().describe('e.g. "dark mode", "error state"'),
        description: z
          .string()
          .max(10_000)
          .optional()
          .describe('What the screenshot shows and what should change'),
        title: z.string().max(200).optional(),
        session_id: SessionId.optional(),
        agent_session_ref: z.string().max(200).optional().describe('Your own conversation/session reference'),
      }),
      output: z.object({
        session_id: z.string(),
        screenshot_id: z.string(),
        ui_id: z.string(),
        status: z.enum(SESSION_STATUSES),
        assignment: z.string(),
        editor_url: z.string(),
        session: SessionOut,
        screenshot: ScreenshotOut,
      }),
      readOnly: false,
      idempotent: false,
    },
    async (args) => {
      const bytes = decodeImage(args.image_base64);
      const result = await submitScreenshot(
        ctx,
        actor,
        {
          projectId: args.project_id,
          source: 'mcp',
          ...(args.ui_path === undefined ? {} : { uiPath: args.ui_path }),
          ...(args.ui_id === undefined ? {} : { uiId: args.ui_id }),
          ...(args.ui_id_hint === undefined ? {} : { uiIdHint: args.ui_id_hint }),
          ...(args.session_id === undefined ? {} : { sessionId: args.session_id }),
          ...(args.agent_session_ref === undefined ? {} : { agentSessionRef: args.agent_session_ref }),
          ...(args.title === undefined ? {} : { title: args.title }),
          metadata: {
            ...(args.viewport_width === undefined ? {} : { viewportWidth: args.viewport_width }),
            ...(args.viewport_height === undefined ? {} : { viewportHeight: args.viewport_height }),
            ...(args.device_type === undefined ? {} : { deviceCategory: args.device_type }),
            ...(args.variant_label === undefined ? {} : { variantLabel: args.variant_label }),
            ...(args.description === undefined ? {} : { description: args.description }),
          },
        },
        bytes,
      );
      const session = presentSession(p, result.session);
      return {
        data: {
          session_id: result.session.id,
          screenshot_id: result.screenshot.id,
          ui_id: result.uiView.uiId,
          status: result.session.status,
          assignment: result.session.assignment,
          editor_url: session.editor_url,
          session,
          screenshot: presentScreenshot(ctx, result.screenshot),
        },
        text:
          `Session ${result.session.id} (${result.session.status}) for ${result.uiView.uiId}. ` +
          `Ask the human to specify it at ${session.editor_url}`,
      };
    },
  );

  register(
    server,
    'opsis_get_screenshot',
    {
      title: 'Get screenshot',
      description: 'Screenshot metadata and the status of its session; optionally a reduced image.',
      input: z.object({
        screenshot_id: Id,
        include_image: z
          .boolean()
          .optional()
          .describe(`Adds a WebP thumbnail (max. ${String(THUMBNAIL_EDGE)} px)`),
      }),
      output: z.object({ screenshot: ScreenshotOut, session_status: z.enum(SESSION_STATUSES).nullable() }),
      readOnly: true,
    },
    async ({ screenshot_id, include_image }) => {
      const screenshot = getScreenshot(ctx, actor, screenshot_id);
      const status =
        screenshot.sessionId === null
          ? null
          : (ctx.repos.sessions.findById(screenshot.sessionId)?.status ?? null);
      const extra: ContentBlock[] = [];
      if (include_image === true) {
        const { bytes } = await readScreenshotImage(ctx, actor, screenshot_id);
        const thumbnail = await ctx.images.thumbnail(bytes, THUMBNAIL_EDGE);
        extra.push({
          type: 'image',
          mimeType: 'image/webp',
          data: Buffer.from(thumbnail).toString('base64'),
        });
      }
      return {
        data: { screenshot: presentScreenshot(ctx, screenshot), session_status: status },
        text: `Screenshot ${screenshot.id}: ${String(screenshot.width)}×${String(screenshot.height)} ${screenshot.mimeType}`,
        extra,
      };
    },
  );

  register(
    server,
    'opsis_list_screenshots',
    {
      title: 'List screenshots',
      description: 'Screenshots of a project, optionally of one UI view.',
      input: z.object({ project_id: ProjectId, ui_id: UiId.optional() }),
      output: z.object({ screenshots: z.array(ScreenshotOut) }),
      readOnly: true,
    },
    ({ project_id, ui_id }) => {
      const uiViewId = ui_id === undefined ? undefined : findUiView(ctx, actor, project_id, ui_id).id;
      const screenshots = listScreenshots(ctx, actor, {
        projectId: project_id,
        ...(uiViewId === undefined ? {} : { uiViewId }),
      }).map((screenshot) => presentScreenshot(ctx, screenshot));
      return { data: { screenshots }, text: `${String(screenshots.length)} screenshots` };
    },
  );

  // ── Specification workflow ──
  register(
    server,
    'opsis_get_session',
    {
      title: 'Get session',
      description: 'A session with its screenshots, base version and status history.',
      input: z.object({ session_id: SessionId }),
      output: z.object({
        session: SessionOut,
        screenshots: z.array(ScreenshotOut),
        status_history: z.array(z.looseObject({ to: z.enum(SESSION_STATUSES) })),
        next_action: z.string(),
      }),
      readOnly: true,
    },
    ({ session_id }) => {
      const details = getSession(ctx, actor, session_id);
      return {
        data: {
          session: presentSession(p, details.session),
          screenshots: details.screenshots.map((screenshot) => presentScreenshot(ctx, screenshot)),
          status_history: details.statusHistory.map((event) => ({
            from: event.fromStatus,
            to: event.toStatus,
            note: event.note,
            at: event.at,
          })),
          next_action: nextAction(details.session.status),
        },
        text: `Session ${details.session.id}: ${details.session.status}. ${nextAction(details.session.status)}`,
      };
    },
  );

  register(
    server,
    'opsis_get_session_status',
    {
      title: 'Get session status',
      description: 'The current status of a session and what to do next.',
      input: z.object({ session_id: SessionId }),
      output: z.object({
        status: z.enum(SESSION_STATUSES),
        assignment: z.string(),
        updated_at: z.string(),
        result_version_id: z.string().optional(),
        next_action: z.string(),
      }),
      readOnly: true,
    },
    ({ session_id }) => {
      const { session } = getSession(ctx, actor, session_id);
      return {
        data: {
          status: session.status,
          assignment: session.assignment,
          updated_at: session.updatedAt,
          ...(session.resultVersionId === null ? {} : { result_version_id: session.resultVersionId }),
          next_action: nextAction(session.status),
        },
        text: `${session.status}. ${nextAction(session.status)}`,
      };
    },
  );

  const VersionRefInput = z.object({
    session_id: SessionId.optional(),
    version_id: Id.optional().describe('Released UI version (uvr_…)'),
  });
  const versionRef = (args: { session_id?: string | undefined; version_id?: string | undefined }) => {
    if ((args.session_id === undefined) === (args.version_id === undefined)) {
      throw new OpsisError('VALIDATION', 'Give exactly one of session_id or version_id');
    }
    return args.session_id === undefined ? { versionId: args.version_id } : { sessionId: args.session_id };
  };

  register(
    server,
    'opsis_wait_for_specification',
    {
      title: 'Wait for specification',
      description:
        'Waits until a human has released the specification of a session (or the session ended), at most ' +
        'timeout_seconds. Returns done=false on timeout – then simply call it again (resume). Sends progress ' +
        'notifications every 15 s when the request carries a progressToken.',
      input: z.object({
        session_id: SessionId,
        timeout_seconds: z
          .number()
          .int()
          .min(WAIT_LIMITS.minSeconds)
          .max(WAIT_LIMITS.maxSeconds)
          .default(WAIT_LIMITS.defaultSeconds),
      }),
      output: z.object({
        done: z.boolean(),
        status: z.enum(SESSION_STATUSES),
        waited_seconds: z.number(),
        next_action: z.string(),
        resume: z.object({ tool: z.string(), arguments: z.record(z.string(), z.unknown()) }).optional(),
      }),
      readOnly: true,
      idempotent: true,
    },
    async ({ session_id, timeout_seconds }, extra) => {
      const progressToken = extra.mcpReq._meta?.progressToken;
      const result = await waitForSpecification(ctx, actor, session_id, {
        timeoutMs: timeout_seconds * 1000,
        signal: p.signal ? AbortSignal.any([extra.mcpReq.signal, p.signal]) : extra.mcpReq.signal,
        ...(p.wait?.pollMs === undefined ? {} : { pollMs: p.wait.pollMs }),
        ...(p.wait?.progressMs === undefined ? {} : { progressMs: p.wait.progressMs }),
        ...(progressToken === undefined
          ? {}
          : {
              onProgress: (progress) =>
                extra.mcpReq.notify({
                  method: 'notifications/progress',
                  params: {
                    progressToken,
                    progress: progress.waitedSeconds,
                    message: `${progress.status}: ${String(progress.componentCount)} components`,
                  },
                }),
            }),
      });
      const resume = result.done
        ? {}
        : {
            resume: {
              tool: 'opsis_wait_for_specification',
              arguments: { session_id, timeout_seconds },
            },
          };
      return {
        data: {
          done: result.done,
          status: result.status,
          waited_seconds: result.waitedSeconds,
          next_action: nextAction(result.status),
          ...resume,
        },
        text: result.done
          ? `${result.status}. ${nextAction(result.status)}`
          : `Still ${result.status} after ${String(result.waitedSeconds)} s. Call opsis_wait_for_specification again.`,
      };
    },
  );

  register(
    server,
    'opsis_get_specification',
    {
      title: 'Get specification',
      description:
        'The released specification as JSON or Markdown. Fails with NOT_READY until a human has released it.',
      input: VersionRefInput.extend({ format: z.enum(['json', 'markdown']).default('json') }),
      output: z.object({
        format: z.enum(['json', 'markdown']),
        specification: z.unknown(),
        references: z.looseObject({ uiVersionId: z.string(), versionNo: z.number() }),
      }),
      readOnly: true,
    },
    (args) => {
      const result = getSpecification(ctx, actor, versionRef(args), args.format);
      return {
        data: { format: result.format, specification: result.content, references: result.references },
        text:
          result.format === 'markdown' && typeof result.content === 'string'
            ? result.content
            : `Specification V${String(result.references.versionNo)} (${result.references.uiVersionId})`,
      };
    },
  );

  register(
    server,
    'opsis_get_implementation_prompt',
    {
      title: 'Get implementation prompt',
      description:
        'The implementation prompt of the released version (Markdown). The first call marks the session ' +
        'as delivered. Fails with NOT_READY until a human has released the specification.',
      input: VersionRefInput,
      output: z.object({
        markdown: z.string(),
        ui_version_id: z.string(),
        version_no: z.number(),
        spec_revision_id: z.string(),
        prompt_version_id: z.string(),
      }),
      readOnly: false,
      idempotent: true,
    },
    (args) => {
      const prompt = getImplementationPrompt(ctx, actor, versionRef(args));
      return {
        data: {
          markdown: prompt.markdown,
          ui_version_id: prompt.uiVersionId,
          version_no: prompt.versionNo,
          spec_revision_id: prompt.specRevisionId,
          prompt_version_id: prompt.promptVersionId,
        },
        text: prompt.markdown,
      };
    },
  );

  register(
    server,
    'opsis_cancel_session',
    {
      title: 'Cancel session',
      description: 'Cancels a session this agent created (e.g. a screenshot submitted by mistake).',
      input: z.object({ session_id: SessionId, reason: z.string().min(1).max(2000) }),
      output: z.object({ session: SessionOut }),
      readOnly: false,
      idempotent: false,
      destructive: true,
    },
    ({ session_id, reason }) => {
      const session = cancelSession(ctx, actor, session_id, reason);
      return { data: { session: presentSession(p, session) }, text: `Session ${session.id} cancelled` };
    },
  );

  registerResources(server, p, actor);
  return server;
};
