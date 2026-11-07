import { z } from 'zod';
import { actorRef, type Actor } from '../domain/actor.js';
import { OpsisError } from '../domain/errors.js';
import { newId } from '../domain/ids.js';
import {
  IMAGE_LIMITS,
  SCREENSHOT_SOURCES,
  ScreenshotMetadataSchema,
  type Screenshot,
  type ScreenshotMetadata,
  type ScreenshotSource,
} from '../domain/screenshot.js';
import { isEditable, type Session, type SessionAssignment } from '../domain/session.js';
import { UiIdSchema, UiPathSchema, type UiView } from '../domain/ui-view.js';
import { commit, parseInput, type AppContext, type UnitOfWork } from './context.js';
import type { InspectedImage } from './ports.js';
import { getProject } from './projects.js';
import { findSession, recordStatusEvent, transitionSession } from './sessions.js';
import { insertUiView } from './ui-views.js';

export const SubmitScreenshotInputSchema = z
  .strictObject({
    projectId: z.string().min(1),
    /** Existing UI view. If unknown in the project, a new UI view with exactly this UI-ID is created. */
    uiId: UiIdSchema.optional(),
    /** Preferred UI-ID for a new UI view; made unique if taken. Ignored when `uiId` is given. */
    uiIdHint: UiIdSchema.optional(),
    uiPath: UiPathSchema.optional(),
    /** Attach the screenshot (e.g. a mobile variant) to an open session instead of creating one. */
    sessionId: z.string().min(1).optional(),
    agentSessionRef: z.string().trim().min(1).max(200).optional(),
    title: z.string().trim().max(200).optional(),
    source: z.enum(SCREENSHOT_SOURCES),
    metadata: ScreenshotMetadataSchema.default({ deviceCategory: 'desktop', description: '' }),
  })
  .refine(
    (input) => input.sessionId !== undefined || input.uiId !== undefined || input.uiPath !== undefined,
    {
      message: 'uiPath is required unless uiId or sessionId is given',
      path: ['uiPath'],
    },
  );

export interface SubmitScreenshotInput {
  projectId: string;
  uiId?: string | undefined;
  uiIdHint?: string | undefined;
  uiPath?: string | undefined;
  sessionId?: string | undefined;
  agentSessionRef?: string | undefined;
  title?: string | undefined;
  source: ScreenshotSource;
  metadata?: ScreenshotMetadata | undefined;
}

export interface SubmitScreenshotResult {
  readonly session: Session;
  readonly screenshot: Screenshot;
  readonly uiView: UiView;
  readonly uiViewCreated: boolean;
  readonly sessionCreated: boolean;
}

interface Assignment {
  view: UiView;
  created: boolean;
  assignment: SessionAssignment;
  proposedPath: string | null;
  note: string | null;
}

/**
 * Deterministic UI assignment (architecture 04 §3). OPSIS never merges UI views based
 * on file names or image similarity; whenever the input is ambiguous the session is
 * marked `needs_confirmation` and a human decides.
 */
const resolveAssignment = (
  ctx: AppContext,
  actor: Actor,
  uow: UnitOfWork,
  input: {
    projectId: string;
    uiId?: string | undefined;
    uiIdHint?: string | undefined;
    uiPath?: string | undefined;
  },
): Assignment => {
  const { projectId, uiId, uiPath } = input;
  const byId = uiId === undefined ? undefined : ctx.repos.uiViews.findByUiId(projectId, uiId);
  const byPath = uiPath === undefined ? undefined : ctx.repos.uiViews.findByPath(projectId, uiPath);

  if (byId) {
    if (uiPath === undefined || uiPath === byId.path) {
      return { view: byId, created: false, assignment: 'confirmed', proposedPath: null, note: null };
    }
    return {
      view: byId,
      created: false,
      assignment: 'needs_confirmation',
      proposedPath: byPath ? null : uiPath,
      note: byPath
        ? `Submitted path "${uiPath}" belongs to UI "${byPath.uiId}", but UI-ID "${byId.uiId}" (path "${byId.path}") was given.`
        : `Submitted path "${uiPath}" differs from the current path "${byId.path}" of UI "${byId.uiId}".`,
    };
  }

  if (byPath) {
    return {
      view: byPath,
      created: false,
      assignment: 'needs_confirmation',
      proposedPath: null,
      note:
        uiId === undefined
          ? `No UI-ID given; path "${uiPath ?? ''}" belongs to existing UI "${byPath.uiId}".`
          : `Unknown UI-ID "${uiId}" was given, but path "${uiPath ?? ''}" belongs to existing UI "${byPath.uiId}".`,
    };
  }

  if (uiPath === undefined) {
    throw new OpsisError('VALIDATION', `UI "${uiId ?? ''}" does not exist; uiPath is required to create it`);
  }
  const view = insertUiView(ctx, actor, uow, { projectId, uiId, uiIdHint: input.uiIdHint, path: uiPath });
  return { view, created: true, assignment: 'confirmed', proposedPath: null, note: null };
};

const inspectImage = async (ctx: AppContext, bytes: Uint8Array): Promise<InspectedImage> => {
  if (bytes.byteLength === 0) throw new OpsisError('VALIDATION', 'Image is empty');
  if (bytes.byteLength > IMAGE_LIMITS.maxBytes) {
    throw new OpsisError('PAYLOAD_TOO_LARGE', `Image exceeds ${IMAGE_LIMITS.maxBytes} bytes`, {
      maxBytes: IMAGE_LIMITS.maxBytes,
    });
  }
  return ctx.images.inspect(bytes);
};

/**
 * Stores a screenshot and – unless `sessionId` is given – opens a new session for it.
 * The image is validated and written to the blob store before the transaction; the
 * transaction then records blob, screenshot, session and status events atomically.
 */
export const submitScreenshot = async (
  ctx: AppContext,
  actor: Actor,
  input: SubmitScreenshotInput,
  bytes: Uint8Array,
): Promise<SubmitScreenshotResult> => {
  const data = parseInput(SubmitScreenshotInputSchema, input);
  getProject(ctx, actor, data.projectId);
  if (data.sessionId !== undefined) findSession(ctx, actor, data.sessionId);

  const image = await inspectImage(ctx, bytes);
  const blob = await ctx.blobs.put(bytes, image.mimeType);

  return commit(ctx, actor, (uow) => {
    let session: Session;
    let view: UiView;
    let uiViewCreated = false;
    const sessionCreated = data.sessionId === undefined;

    if (data.sessionId !== undefined) {
      session = findSession(ctx, actor, data.sessionId);
      if (session.projectId !== data.projectId) {
        throw new OpsisError(
          'NOT_FOUND',
          `session "${data.sessionId}" not found in project "${data.projectId}"`,
        );
      }
      if (!isEditable(session.status)) {
        throw new OpsisError(
          'INVALID_TRANSITION',
          `Cannot add screenshots to a session in status "${session.status}"`,
          {
            sessionId: session.id,
            status: session.status,
          },
        );
      }
      const sessionView = ctx.repos.uiViews.findById(session.uiViewId);
      if (!sessionView) throw new OpsisError('NOT_FOUND', `UI view of session "${session.id}" not found`);
      if (data.uiId !== undefined && data.uiId !== sessionView.uiId) {
        throw new OpsisError(
          'VALIDATION',
          `Session "${session.id}" belongs to UI "${sessionView.uiId}", not "${data.uiId}"`,
        );
      }
      view = sessionView;
    } else {
      const resolved = resolveAssignment(ctx, actor, uow, data);
      view = resolved.view;
      uiViewCreated = resolved.created;
      const created: Session = {
        id: newId('session'),
        projectId: data.projectId,
        uiViewId: view.id,
        agentId: actor.type === 'agent' ? actor.id : null,
        agentSessionRef: data.agentSessionRef ?? null,
        intent: view.headVersionId === null ? 'create' : 'revise',
        title: data.title ?? '',
        status: 'created',
        assignment: resolved.assignment,
        proposedPath: resolved.proposedPath,
        assignmentNote: resolved.note,
        baseVersionId: view.headVersionId,
        resultVersionId: null,
        statusReason: null,
        rowVersion: 1,
        createdAt: uow.now,
        updatedAt: uow.now,
      };
      ctx.repos.sessions.insert(created);
      ctx.repos.sessions.createEmptyDraft(created.id, uow.now);
      recordStatusEvent(ctx, actor, uow, created.id, null, 'created', null);
      uow.audit({
        projectId: data.projectId,
        entityType: 'session',
        entityId: created.id,
        action: 'create',
        data: { uiId: view.uiId, assignment: created.assignment, intent: created.intent },
      });
      session = transitionSession(ctx, actor, uow, created, 'uploading');
    }

    ctx.repos.screenshots.insertBlobIfMissing(blob, uow.now);
    const meta = data.metadata;
    const screenshot: Screenshot = {
      id: newId('screenshot'),
      projectId: data.projectId,
      uiViewId: view.id,
      sessionId: session.id,
      blobSha256: blob.sha256,
      mimeType: image.mimeType,
      width: image.width,
      height: image.height,
      viewportWidth: meta.viewportWidth ?? null,
      viewportHeight: meta.viewportHeight ?? null,
      deviceCategory: meta.deviceCategory,
      variantLabel: meta.variantLabel ?? null,
      sequenceNo: ctx.repos.screenshots.nextSequenceNo(view.id),
      capturedAt: meta.capturedAt ?? null,
      source: data.source,
      submittedBy: actorRef(actor),
      description: meta.description,
      createdAt: uow.now,
    };
    ctx.repos.screenshots.insert(screenshot);
    uow.audit({
      projectId: data.projectId,
      entityType: 'screenshot',
      entityId: screenshot.id,
      action: 'submit',
      data: { sessionId: session.id, sha256: blob.sha256, width: image.width, height: image.height },
    });
    uow.emit({
      type: 'ScreenshotSubmitted',
      projectId: data.projectId,
      uiViewId: view.id,
      screenshotId: screenshot.id,
      sessionId: session.id,
    });

    if (sessionCreated) session = transitionSession(ctx, actor, uow, session, 'awaiting_review');
    return { session, screenshot, uiView: view, uiViewCreated, sessionCreated };
  });
};

export const getScreenshot = (ctx: AppContext, actor: Actor, screenshotId: string): Screenshot => {
  const screenshot = ctx.repos.screenshots.findById(screenshotId);
  if (!screenshot || !ctx.access.canAccessProject(actor, screenshot.projectId)) {
    throw new OpsisError('NOT_FOUND', `screenshot "${screenshotId}" not found`);
  }
  return screenshot;
};

export const listScreenshots = (
  ctx: AppContext,
  actor: Actor,
  filter: { projectId: string; uiViewId?: string; sessionId?: string },
): Screenshot[] => {
  ctx.access.assertProjectAccess(actor, filter.projectId);
  return ctx.repos.screenshots.list(filter);
};

export const readScreenshotImage = async (
  ctx: AppContext,
  actor: Actor,
  screenshotId: string,
): Promise<{ screenshot: Screenshot; bytes: Uint8Array }> => {
  const screenshot = getScreenshot(ctx, actor, screenshotId);
  return { screenshot, bytes: await ctx.blobs.read(screenshot.blobSha256) };
};
