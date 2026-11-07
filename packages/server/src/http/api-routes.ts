import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ChangeUiPathInputSchema,
  CreateProjectInputSchema,
  CreateUiViewInputSchema,
  DEVICE_CATEGORIES,
  UpdateProjectInputSchema,
  IMAGE_LIMITS,
  LOCAL_HUMAN,
  OpsisError,
  SESSION_STATUSES,
  cancelSession,
  changeUiPath,
  confirmAssignment,
  createProject,
  createUiView,
  findUiView,
  getProject,
  getScreenshot,
  getSession,
  getUiView,
  listProjects,
  listScreenshots,
  listSessions,
  listUiViews,
  parseInput,
  readScreenshotImage,
  startReview,
  submitScreenshot,
  updateProject,
  type AppContext,
  type ScreenshotMetadata,
} from '@opsis/core';

/** The web UI acts as the single local human user (decision E1). */
const actor = LOCAL_HUMAN;

const ProjectParams = z.object({ projectId: z.string().min(1).max(64) });
const UiParams = ProjectParams.extend({ uiId: z.string().min(1).max(100) });
const IdParams = z.object({ id: z.string().min(1).max(64) });

const params = <S extends z.ZodType>(schema: S, request: FastifyRequest): z.output<S> =>
  parseInput(schema, request.params);

const SessionQuery = z.strictObject({
  uiId: z.string().optional(),
  status: z
    .string()
    .transform((value) => value.split(',').filter((s) => s.length > 0))
    .pipe(z.array(z.enum(SESSION_STATUSES)))
    .optional(),
});
const ScreenshotQuery = z.strictObject({ uiId: z.string().optional(), sessionId: z.string().optional() });
const CancelBody = z.strictObject({ reason: z.string().max(2000).default('') });
const ConfirmBody = z.strictObject({ acceptProposedPath: z.boolean() });

/** Multipart text fields accepted next to the image file. */
const UploadFields = z.strictObject({
  uiPath: z.string().optional(),
  uiId: z.string().optional(),
  sessionId: z.string().optional(),
  title: z.string().optional(),
  deviceCategory: z.enum(DEVICE_CATEGORIES).optional(),
  variantLabel: z.string().optional(),
  viewportWidth: z.coerce.number().int().optional(),
  viewportHeight: z.coerce.number().int().optional(),
  capturedAt: z.string().optional(),
  description: z.string().optional(),
});

const optional = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> =>
  value === undefined ? {} : ({ [key]: value } as Record<K, V>);

export const registerApiRoutes = (app: FastifyInstance, ctx: AppContext): void => {
  app.get('/api/v1/health', () => ({ status: 'ok' }));

  // ── Projects ──────────────────────────────────────────────────────────────
  app.get('/api/v1/projects', () => ({ projects: listProjects(ctx, actor) }));
  app.post('/api/v1/projects', async (request, reply) => {
    const project = createProject(ctx, actor, parseInput(CreateProjectInputSchema, request.body));
    return reply.status(201).send(project);
  });
  app.get('/api/v1/projects/:projectId', (request) =>
    getProject(ctx, actor, params(ProjectParams, request).projectId),
  );
  app.patch('/api/v1/projects/:projectId', (request) =>
    updateProject(
      ctx,
      actor,
      params(ProjectParams, request).projectId,
      parseInput(UpdateProjectInputSchema, request.body),
    ),
  );

  // ── UI views ──────────────────────────────────────────────────────────────
  app.get('/api/v1/projects/:projectId/ui-views', (request) => ({
    uiViews: listUiViews(ctx, actor, params(ProjectParams, request).projectId),
  }));
  app.post('/api/v1/projects/:projectId/ui-views', async (request, reply) => {
    const view = createUiView(
      ctx,
      actor,
      params(ProjectParams, request).projectId,
      parseInput(CreateUiViewInputSchema, request.body),
    );
    return reply.status(201).send(view);
  });
  app.get('/api/v1/projects/:projectId/ui-views/:uiId', (request) => {
    const { projectId, uiId } = params(UiParams, request);
    return getUiView(ctx, actor, projectId, uiId);
  });
  app.patch('/api/v1/projects/:projectId/ui-views/:uiId/path', (request) => {
    const { projectId, uiId } = params(UiParams, request);
    return changeUiPath(ctx, actor, projectId, uiId, parseInput(ChangeUiPathInputSchema, request.body));
  });

  // ── Sessions ──────────────────────────────────────────────────────────────
  app.get('/api/v1/projects/:projectId/sessions', (request) => {
    const { projectId } = params(ProjectParams, request);
    const query = parseInput(SessionQuery, request.query);
    const uiViewId = query.uiId === undefined ? undefined : findUiView(ctx, actor, projectId, query.uiId).id;
    return {
      sessions: listSessions(ctx, actor, {
        projectId,
        ...optional('uiViewId', uiViewId),
        ...optional('statuses', query.status),
      }),
    };
  });
  app.get('/api/v1/sessions/:id', (request) => getSession(ctx, actor, params(IdParams, request).id));
  app.post('/api/v1/sessions/:id/start-review', (request) =>
    startReview(ctx, actor, params(IdParams, request).id),
  );
  app.post('/api/v1/sessions/:id/cancel', (request) => {
    const body = parseInput(CancelBody, request.body ?? {});
    return cancelSession(ctx, actor, params(IdParams, request).id, body.reason);
  });
  app.post('/api/v1/sessions/:id/confirm-assignment', (request) =>
    confirmAssignment(ctx, actor, params(IdParams, request).id, parseInput(ConfirmBody, request.body)),
  );

  // ── Screenshots ───────────────────────────────────────────────────────────
  app.get('/api/v1/projects/:projectId/screenshots', (request) => {
    const { projectId } = params(ProjectParams, request);
    const query = parseInput(ScreenshotQuery, request.query);
    const uiViewId = query.uiId === undefined ? undefined : findUiView(ctx, actor, projectId, query.uiId).id;
    return {
      screenshots: listScreenshots(ctx, actor, {
        projectId,
        ...optional('uiViewId', uiViewId),
        ...optional('sessionId', query.sessionId),
      }),
    };
  });
  app.get('/api/v1/screenshots/:id', (request) => getScreenshot(ctx, actor, params(IdParams, request).id));
  app.get('/api/v1/screenshots/:id/image', async (request, reply) => {
    const { screenshot, bytes } = await readScreenshotImage(ctx, actor, params(IdParams, request).id);
    return reply
      .header('content-type', screenshot.mimeType)
      .header('cache-control', 'private, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'")
      .send(Buffer.from(bytes));
  });

  app.post('/api/v1/projects/:projectId/screenshots', async (request, reply) => {
    const { projectId } = params(ProjectParams, request);
    if (!request.isMultipart()) throw new OpsisError('UNSUPPORTED_MEDIA', 'Expected multipart/form-data');
    const fields: Record<string, string> = {};
    let image: Buffer | undefined;
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (image !== undefined) throw new OpsisError('VALIDATION', 'Exactly one image file is expected');
        image = await part.toBuffer();
      } else if (typeof part.value === 'string') {
        fields[part.fieldname] = part.value;
      }
    }
    if (image === undefined) throw new OpsisError('VALIDATION', 'Missing image file');
    const f = parseInput(UploadFields, fields);
    const metadata: ScreenshotMetadata = {
      ...optional('deviceCategory', f.deviceCategory),
      ...optional('variantLabel', f.variantLabel),
      ...optional('viewportWidth', f.viewportWidth),
      ...optional('viewportHeight', f.viewportHeight),
      ...optional('capturedAt', f.capturedAt),
      ...optional('description', f.description),
    };
    const result = await submitScreenshot(
      ctx,
      actor,
      {
        projectId,
        source: 'upload',
        metadata,
        ...optional('uiPath', f.uiPath),
        ...optional('uiId', f.uiId),
        ...optional('sessionId', f.sessionId),
        ...optional('title', f.title),
      },
      new Uint8Array(image.buffer, image.byteOffset, image.byteLength),
    );
    return reply.status(201).send(result);
  });
};

export const MULTIPART_LIMITS = {
  fileSize: IMAGE_LIMITS.maxBytes,
  files: 1,
  fields: 20,
  fieldSize: 16 * 1024,
  parts: 25,
} as const;
