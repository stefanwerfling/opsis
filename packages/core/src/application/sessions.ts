import { actorRef, type Actor } from '../domain/actor.js';
import { OpsisError } from '../domain/errors.js';
import { newId } from '../domain/ids.js';
import type { Screenshot } from '../domain/screenshot.js';
import { assertTransition, type Session, type SessionStatus } from '../domain/session.js';
import type { UiView } from '../domain/ui-view.js';
import { commit, type AppContext, type UnitOfWork } from './context.js';
import type { SessionStatusEvent } from './ports.js';
import { applyPathChange } from './ui-views.js';

/**
 * The only place where a session status changes: validates the transition and actor
 * centrally, uses optimistic locking, records a status event and emits a domain event.
 */
export const transitionSession = (
  ctx: AppContext,
  actor: Actor,
  uow: UnitOfWork,
  session: Session,
  to: SessionStatus,
  note: string | null = null,
): Session => {
  assertTransition(session, to, actor);
  const updated: Session = {
    ...session,
    status: to,
    statusReason: note,
    rowVersion: session.rowVersion + 1,
    updatedAt: uow.now,
  };
  ctx.repos.sessions.update(updated, session.rowVersion);
  recordStatusEvent(ctx, actor, uow, session.id, session.status, to, note);
  uow.emit({
    type: 'SessionStatusChanged',
    projectId: session.projectId,
    sessionId: session.id,
    from: session.status,
    to,
  });
  return updated;
};

export const recordStatusEvent = (
  ctx: AppContext,
  actor: Actor,
  uow: UnitOfWork,
  sessionId: string,
  from: SessionStatus | null,
  to: SessionStatus,
  note: string | null,
): void => {
  ctx.repos.sessions.insertStatusEvent({
    id: newId('sessionEvent'),
    sessionId,
    fromStatus: from,
    toStatus: to,
    actor: actorRef(actor),
    note,
    at: uow.now,
  });
};

export const findSession = (ctx: AppContext, actor: Actor, sessionId: string): Session => {
  const session = ctx.repos.sessions.findById(sessionId);
  if (!session || !ctx.access.canAccessProject(actor, session.projectId)) {
    throw new OpsisError('NOT_FOUND', `session "${sessionId}" not found`);
  }
  return session;
};

export interface SessionDetails {
  readonly session: Session;
  readonly uiView: UiView;
  readonly screenshots: Screenshot[];
  readonly statusHistory: SessionStatusEvent[];
  /** Other open sessions on the same UI view – shown as a conflict hint in the editor. */
  readonly concurrentSessionIds: string[];
}

const OPEN_STATUSES: readonly SessionStatus[] = [
  'created',
  'uploading',
  'awaiting_review',
  'in_progress',
  'ready',
];

export const getSession = (ctx: AppContext, actor: Actor, sessionId: string): SessionDetails => {
  const session = findSession(ctx, actor, sessionId);
  const uiView = ctx.repos.uiViews.findById(session.uiViewId);
  if (!uiView) throw new OpsisError('NOT_FOUND', `UI view of session "${sessionId}" not found`);
  return {
    session,
    uiView,
    screenshots: ctx.repos.screenshots.list({ projectId: session.projectId, sessionId }),
    statusHistory: ctx.repos.sessions.listStatusEvents(sessionId),
    concurrentSessionIds: ctx.repos.sessions
      .list({ projectId: session.projectId, uiViewId: session.uiViewId, statuses: OPEN_STATUSES })
      .map((other) => other.id)
      .filter((id) => id !== sessionId),
  };
};

export const listSessions = (
  ctx: AppContext,
  actor: Actor,
  filter: { projectId: string; uiViewId?: string; statuses?: readonly SessionStatus[] },
): Session[] => {
  ctx.access.assertProjectAccess(actor, filter.projectId);
  return ctx.repos.sessions.list(filter);
};

/** Human opens the session in the editor and starts working: awaiting_review → in_progress. */
export const startReview = (ctx: AppContext, actor: Actor, sessionId: string): Session =>
  commit(ctx, actor, (uow) => {
    const session = findSession(ctx, actor, sessionId);
    if (session.status === 'in_progress') return session;
    return transitionSession(ctx, actor, uow, session, 'in_progress');
  });

export const cancelSession = (ctx: AppContext, actor: Actor, sessionId: string, reason: string): Session =>
  commit(ctx, actor, (uow) => {
    const session = findSession(ctx, actor, sessionId);
    const updated = transitionSession(ctx, actor, uow, session, 'cancelled', reason.slice(0, 2000) || null);
    uow.audit({
      projectId: session.projectId,
      entityType: 'session',
      entityId: sessionId,
      action: 'cancel',
      data: { reason },
    });
    return updated;
  });

/**
 * Human resolves an uncertain assignment (architecture 04 §3). With `acceptProposedPath`
 * the UI view's path is changed to the path the submitter reported; otherwise it is kept.
 */
export const confirmAssignment = (
  ctx: AppContext,
  actor: Actor,
  sessionId: string,
  input: { acceptProposedPath: boolean },
): Session =>
  commit(ctx, actor, (uow) => {
    if (actor.type !== 'human') {
      throw new OpsisError('FORBIDDEN_ACTOR', 'Only a human may confirm a UI assignment');
    }
    const session = findSession(ctx, actor, sessionId);
    if (session.assignment === 'confirmed') return session;
    if (input.acceptProposedPath && session.proposedPath !== null) {
      const view = ctx.repos.uiViews.findById(session.uiViewId);
      if (!view) throw new OpsisError('NOT_FOUND', `UI view of session "${sessionId}" not found`);
      applyPathChange(ctx, actor, uow, view, session.proposedPath, `confirmed in session ${sessionId}`);
    }
    const updated: Session = {
      ...session,
      assignment: 'confirmed',
      proposedPath: null,
      assignmentNote: null,
      rowVersion: session.rowVersion + 1,
      updatedAt: uow.now,
    };
    ctx.repos.sessions.update(updated, session.rowVersion);
    uow.audit({
      projectId: session.projectId,
      entityType: 'session',
      entityId: sessionId,
      action: 'confirm_assignment',
      data: { acceptProposedPath: input.acceptProposedPath, proposedPath: session.proposedPath },
    });
    uow.emit({ type: 'SessionChanged', projectId: session.projectId, sessionId });
    return updated;
  });
