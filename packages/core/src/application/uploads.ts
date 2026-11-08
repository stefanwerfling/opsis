/**
 * Two-stage upload for large images (06 `opsis_request_upload`, 04 note on
 * `created/uploading`): the agent sends the metadata first and gets a one-time upload URL;
 * the session stays visible in `uploading` until the image arrives. An expired slot moves
 * the session to `failed`.
 */
import { LOCAL_HUMAN, SYSTEM, type Actor } from '../domain/actor.js';
import { OpsisError } from '../domain/errors.js';
import { newId } from '../domain/ids.js';
import type { Session } from '../domain/session.js';
import { randomToken } from '../domain/token.js';
import type { UiView } from '../domain/ui-view.js';
import { commit, parseInput, type AppContext } from './context.js';
import type { UploadSlot } from './ports.js';
import { getProject } from './projects.js';
import {
  SubmitScreenshotInputSchema,
  insertScreenshot,
  inspectImage,
  resolveTarget,
  type ParsedSubmitInput,
  type SubmitScreenshotInput,
  type SubmitScreenshotResult,
} from './screenshots.js';
import { findSession, transitionSession } from './sessions.js';

/** How long an upload slot stays open. */
export const UPLOAD_SLOT_TTL_MS = 15 * 60 * 1000;
export const UPLOAD_TOKEN_PREFIX = 'opsisupl_';
export const UPLOAD_TOKEN_PATTERN = /^opsisupl_[A-Za-z0-9_-]{43}$/;

export interface UploadRequestResult {
  readonly session: Session;
  readonly uiView: UiView;
  readonly uiViewCreated: boolean;
  readonly sessionCreated: boolean;
  readonly slotId: string;
  /** One-time secret for the upload URL; only its hash is stored. */
  readonly token: string;
  readonly expiresAt: string;
}

const notFound = (): OpsisError =>
  new OpsisError('NOT_FOUND', 'Upload slot not found, already used or expired');

/** Moves expired slots to `expired` and their still-waiting sessions to `failed`. */
export const expireUploadSlots = (ctx: AppContext): number =>
  commit(ctx, SYSTEM, (uow) => {
    let count = 0;
    for (const slot of ctx.repos.uploads.listExpired(uow.now)) {
      if (!ctx.repos.uploads.expire(slot.id)) continue;
      count += 1;
      uow.audit({
        projectId: slot.projectId,
        entityType: 'upload_slot',
        entityId: slot.id,
        action: 'expire',
      });
      const session = ctx.repos.sessions.findById(slot.sessionId);
      if (session?.status === 'uploading') {
        transitionSession(ctx, SYSTEM, uow, session, 'failed', 'upload slot expired');
      }
    }
    return count;
  });

export const requestUpload = (
  ctx: AppContext,
  actor: Actor,
  input: SubmitScreenshotInput,
): UploadRequestResult => {
  const data = parseInput(SubmitScreenshotInputSchema, input);
  getProject(ctx, actor, data.projectId);
  return commit(ctx, actor, (uow) => {
    const target = resolveTarget(ctx, actor, uow, data);
    const token = randomToken(UPLOAD_TOKEN_PREFIX);
    const expiresAt = new Date(Date.parse(uow.now) + UPLOAD_SLOT_TTL_MS).toISOString();
    const slot: UploadSlot = {
      id: newId('uploadSlot'),
      projectId: data.projectId,
      sessionId: target.session.id,
      agentId: actor.type === 'agent' ? actor.id : null,
      request: JSON.stringify(data),
      status: 'open',
      createdAt: uow.now,
      expiresAt,
      completedAt: null,
      screenshotId: null,
    };
    ctx.repos.uploads.insert(slot, ctx.hash.sha256(token));
    uow.audit({
      projectId: data.projectId,
      entityType: 'upload_slot',
      entityId: slot.id,
      action: 'request',
      data: { sessionId: slot.sessionId, expiresAt },
    });
    return {
      session: target.session,
      uiView: target.view,
      uiViewCreated: target.uiViewCreated,
      sessionCreated: target.sessionCreated,
      slotId: slot.id,
      token,
      expiresAt,
    };
  });
};

/** The actor that requested the slot – it must still exist, be active and have access. */
const slotActor = (ctx: AppContext, slot: UploadSlot): Actor => {
  if (slot.agentId === null) return LOCAL_HUMAN;
  const agent = ctx.repos.agents.findById(slot.agentId);
  if (!agent || agent.revokedAt !== null) throw notFound();
  const actor: Actor = { type: 'agent', id: agent.id, name: agent.name };
  if (!ctx.access.canAccessProject(actor, slot.projectId)) throw notFound();
  return actor;
};

/**
 * Stores the image of an upload slot. The token is the authorization; it works once.
 * A rejected image (format, size, decoding) leaves the slot open for another attempt.
 */
export const completeUpload = async (
  ctx: AppContext,
  token: string,
  bytes: Uint8Array,
): Promise<SubmitScreenshotResult> => {
  if (!UPLOAD_TOKEN_PATTERN.test(token)) throw notFound();
  expireUploadSlots(ctx);
  const slot = ctx.repos.uploads.findByTokenHash(ctx.hash.sha256(token));
  if (slot?.status !== 'open') throw notFound();
  const actor = slotActor(ctx, slot);
  const data = JSON.parse(slot.request) as ParsedSubmitInput;

  const image = await inspectImage(ctx, bytes);
  const blob = await ctx.blobs.put(bytes, image.mimeType);

  return commit(ctx, actor, (uow) => {
    let session = findSession(ctx, actor, slot.sessionId);
    const view = ctx.repos.uiViews.findById(session.uiViewId);
    if (!view) throw notFound();
    const sessionCreated = data.sessionId === undefined;
    if (
      sessionCreated
        ? session.status !== 'uploading'
        : !['awaiting_review', 'in_progress'].includes(session.status)
    ) {
      throw new OpsisError(
        'INVALID_TRANSITION',
        `Session is "${session.status}", the upload is no longer expected`,
        {
          sessionId: session.id,
          status: session.status,
        },
      );
    }
    const screenshot = insertScreenshot(ctx, actor, uow, data, { session, view }, image, blob);
    // Inside the transaction: a concurrent second use of the token rolls back here.
    if (!ctx.repos.uploads.complete(slot.id, screenshot.id, uow.now)) throw notFound();
    if (sessionCreated) session = transitionSession(ctx, actor, uow, session, 'awaiting_review');
    return { session, screenshot, uiView: view, uiViewCreated: false, sessionCreated };
  });
};
