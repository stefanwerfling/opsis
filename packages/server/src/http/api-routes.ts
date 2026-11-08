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
  SPEC_FORMATS,
  cancelSession,
  createAgent,
  grantAgentProject,
  listAgents,
  revokeAgent,
  revokeAgentProject,
  changeDraft,
  changeUiPath,
  compareUiVersions,
  componentHistory,
  confirmAssignment,
  createProject,
  createUiView,
  exportVersion,
  findUiView,
  getDraft,
  getImplementationPrompt,
  getSpecification,
  getUiVersion,
  getProject,
  getScreenshot,
  getSession,
  getUiView,
  IMPORT_LIMITS,
  importVersionArchive,
  listProjects,
  listScreenshots,
  listSessions,
  listUiViews,
  listUiVersions,
  parseInput,
  pixelDiff,
  readScreenshotImage,
  releaseSpecification,
  rebaseSession,
  reopenSession,
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
const GrantParams = IdParams.extend({ projectId: z.string().min(1).max(64) });
const ComponentParams = UiParams.extend({ componentId: z.string().min(1).max(64) });
const CompareParams = IdParams.extend({ otherId: z.string().min(1).max(64) });
const ExportParams = IdParams.extend({ kind: z.string().min(1).max(32) });
const ExportQuery = z.strictObject({ screenshotId: z.string().optional() });

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
const ReopenBody = z.strictObject({ reason: z.string().max(2000).default('') });
const SpecQuery = z.strictObject({ format: z.enum(SPEC_FORMATS).default('json') });

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
  // ── Agents (04 §4) ────────────────────────────────────────────────────────
  app.get('/api/v1/agents', () => ({ agents: listAgents(ctx, actor) }));
  app.post('/api/v1/agents', (request, reply) =>
    // The token is shown once: never cached.
    reply
      .status(201)
      .header('cache-control', 'no-store')
      .send(createAgent(ctx, actor, request.body)),
  );
  app.post('/api/v1/agents/:id/revoke', (request) => revokeAgent(ctx, actor, params(IdParams, request).id));
  app.put('/api/v1/agents/:id/grants/:projectId', (request) => {
    const { id, projectId } = params(GrantParams, request);
    return grantAgentProject(ctx, actor, id, { projectId });
  });
  app.delete('/api/v1/agents/:id/grants/:projectId', (request) => {
    const { id, projectId } = params(GrantParams, request);
    return revokeAgentProject(ctx, actor, id, { projectId });
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

  app.post('/api/v1/sessions/:id/release', async (request, reply) => {
    const result = releaseSpecification(ctx, actor, params(IdParams, request).id, request.body);
    return reply.status(201).send({ session: result.session, uiVersion: result.uiVersion });
  });
  app.post('/api/v1/sessions/:id/rebase', (request) =>
    rebaseSession(ctx, actor, params(IdParams, request).id, request.body),
  );
  app.post('/api/v1/sessions/:id/reopen', (request) => {
    const body = parseInput(ReopenBody, request.body ?? {});
    return reopenSession(ctx, actor, params(IdParams, request).id, body.reason);
  });

  // ── Released versions (immutable) ─────────────────────────────────────────
  app.get('/api/v1/projects/:projectId/ui-views/:uiId/versions', (request) => {
    const { projectId, uiId } = params(UiParams, request);
    return { versions: listUiVersions(ctx, actor, findUiView(ctx, actor, projectId, uiId).id) };
  });
  app.get('/api/v1/projects/:projectId/ui-views/:uiId/components/:componentId/history', (request) => {
    const { projectId, uiId, componentId } = params(ComponentParams, request);
    return {
      history: componentHistory(ctx, actor, findUiView(ctx, actor, projectId, uiId).id, componentId),
    };
  });
  app.get('/api/v1/versions/:id/pixel-diff/:otherId', async (request, reply) => {
    const { id, otherId } = params(CompareParams, request);
    const result = await pixelDiff(ctx, actor, id, otherId, request.query);
    // The mask is the body; the figures travel in headers so one request suffices.
    return reply
      .header('content-type', 'image/png')
      .header('cache-control', 'private, max-age=3600')
      .header('x-opsis-different-pixels', String(result.differentPixels))
      .header('x-opsis-compared-size', `${String(result.width)}x${String(result.height)}`)
      .header('x-opsis-resized', String(result.resized))
      .header('x-opsis-aspect-ratios', `${result.aspectRatioA.toFixed(4)},${result.aspectRatioB.toFixed(4)}`)
      .header('x-opsis-screenshots', `${result.screenshotA},${result.screenshotB}`)
      .send(Buffer.from(result.png));
  });
  app.get('/api/v1/versions/:id/compare/:otherId', (request) => {
    const { id, otherId } = params(CompareParams, request);
    return compareUiVersions(ctx, actor, id, otherId);
  });
  app.get('/api/v1/versions/:id', (request) => {
    const released = getUiVersion(ctx, actor, params(IdParams, request).id);
    // The snapshot is returned parsed, so the raw canonical JSON (and the prompt text) is left out.
    const { specRevision: spec, promptVersion: prompt } = released;
    return {
      uiVersion: released.uiVersion,
      specRevision: { ...spec, snapshot: undefined },
      promptVersion: { ...prompt, markdown: undefined },
      references: released.references,
      snapshot: released.snapshot,
    };
  });
  app.get('/api/v1/versions/:id/specification', (request, reply) => {
    const { format } = parseInput(SpecQuery, request.query);
    const result = getSpecification(ctx, actor, { versionId: params(IdParams, request).id }, format);
    if (format === 'json') return result.content;
    return reply.type('text/markdown; charset=utf-8').send(result.content);
  });
  app.get('/api/v1/versions/:id/prompt', (request, reply) => {
    // The local human reads the prompt; only an agent's retrieval marks a session delivered.
    const prompt = getImplementationPrompt(ctx, actor, { versionId: params(IdParams, request).id });
    return reply.type('text/markdown; charset=utf-8').send(prompt.markdown);
  });

  app.get('/api/v1/versions/:id/export/:kind', async (request, reply) => {
    const { id, kind } = params(ExportParams, request);
    const file = await exportVersion(ctx, actor, id, { kind, ...parseInput(ExportQuery, request.query) });
    return reply
      .header('content-type', file.contentType)
      .header('content-disposition', `attachment; filename="${file.filename}"`)
      .header('x-content-type-options', 'nosniff')
      .send(Buffer.from(file.bytes));
  });

  // ── Drafts (editor) ───────────────────────────────────────────────────────
  app.get('/api/v1/sessions/:id/draft', (request) => getDraft(ctx, actor, params(IdParams, request).id));
  app.post('/api/v1/sessions/:id/draft/operations', (request) =>
    changeDraft(ctx, actor, params(IdParams, request).id, request.body),
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
  // ── Import (05 §7) ────────────────────────────────────────────────────────
  app.post('/api/v1/projects/:projectId/import', async (request, reply) => {
    const { projectId } = params(ProjectParams, request);
    if (!request.isMultipart()) throw new OpsisError('UNSUPPORTED_MEDIA', 'Expected multipart/form-data');
    let archive: Buffer | undefined;
    for await (const part of request.parts({ limits: { fileSize: IMPORT_LIMITS.maxArchiveBytes } })) {
      if (part.type !== 'file') continue;
      if (archive !== undefined) throw new OpsisError('VALIDATION', 'Exactly one archive file is expected');
      archive = await part.toBuffer();
    }
    if (archive === undefined) throw new OpsisError('VALIDATION', 'Missing archive file');
    const result = await importVersionArchive(
      ctx,
      actor,
      { projectId },
      new Uint8Array(archive.buffer, archive.byteOffset, archive.byteLength),
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
