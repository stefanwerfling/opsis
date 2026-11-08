/**
 * Release of a specification by a human (architecture 05 §2) – one transaction that turns
 * the mutable draft into immutable history: component revisions (deduplicated), spec
 * revision, prompt version and UI version. Only a human may release (principle 10); there
 * is no agent path to this use case.
 */
import { z } from 'zod';
import { actorRef, type Actor } from '../domain/actor.js';
import { assessCompleteness, unacknowledgedWarnings } from '../domain/completeness.js';
import { OpsisError } from '../domain/errors.js';
import { newId } from '../domain/ids.js';
import type { Session } from '../domain/session.js';
import { canonicalJson } from '../domain/specification/canonical-json.js';
import { generatePrompt } from '../domain/specification/prompt.js';
import { GENERATOR_VERSION } from '../domain/specification/render.js';
import {
  buildSnapshot,
  componentContent,
  type ReleaseReferences,
  type VersionRef,
} from '../domain/specification/snapshot.js';
import type { PromptVersion, SpecRevision, UiVersion } from '../domain/version.js';
import { commit, parseInput, type AppContext } from './context.js';
import { findSession, transitionSession } from './sessions.js';

export const ReleaseInputSchema = z.strictObject({
  /** Session row version the human saw (optimistic locking). */
  rowVersion: z.number().int().min(1),
  /** Warning ids the human explicitly acknowledged ("release with open points"). */
  acknowledgedWarnings: z.array(z.string().min(1).max(300)).max(5000).default([]),
  changeDescription: z.string().max(10_000).default(''),
  /**
   * Release although another session created a newer version of this UI meanwhile
   * (architecture 04 §2, way 2). The conflict is recorded in the audit log.
   */
  conflictAcknowledged: z.boolean().default(false),
});
export type ReleaseInput = z.input<typeof ReleaseInputSchema>;

export interface ReleaseResult {
  readonly session: Session;
  readonly uiVersion: UiVersion;
  readonly specRevision: SpecRevision;
  readonly promptVersion: PromptVersion;
}

const versionRef = (ctx: AppContext, id: string | null): VersionRef | null => {
  if (id === null) return null;
  const version = ctx.repos.versions.findUiVersion(id);
  if (!version) throw new OpsisError('NOT_FOUND', `UI version "${id}" not found`);
  return { id: version.id, versionNo: version.versionNo };
};

export const releaseSpecification = (
  ctx: AppContext,
  actor: Actor,
  sessionId: string,
  rawInput: unknown,
): ReleaseResult => {
  const input = parseInput(ReleaseInputSchema, rawInput);
  return commit(ctx, actor, (uow) => {
    // 1. Human, session in progress, row version unchanged.
    if (actor.type !== 'human') {
      throw new OpsisError('FORBIDDEN_ACTOR', 'Only a human may release a specification');
    }
    const session = findSession(ctx, actor, sessionId);
    if (session.status !== 'in_progress') {
      throw new OpsisError('INVALID_TRANSITION', `Session is "${session.status}", not in progress`, {
        sessionId,
        status: session.status,
      });
    }
    if (session.rowVersion !== input.rowVersion) {
      throw new OpsisError('VERSION_CONFLICT', 'The session was changed meanwhile', {
        currentRowVersion: session.rowVersion,
      });
    }
    const draft = ctx.repos.drafts.find(sessionId);
    const uiView = ctx.repos.uiViews.findById(session.uiViewId);
    const project = ctx.repos.projects.findById(session.projectId);
    if (!draft || !uiView || !project)
      throw new OpsisError('NOT_FOUND', `Session "${sessionId}" is incomplete`);

    // 2. Completeness: nothing blocking, every warning acknowledged.
    const report = assessCompleteness(draft, { assignment: session.assignment });
    const unacknowledged = unacknowledgedWarnings(report, input.acknowledgedWarnings);
    if (report.blocking.length > 0 || unacknowledged.length > 0) {
      throw new OpsisError('INCOMPLETE', 'The specification cannot be released yet', {
        blocking: report.blocking,
        unacknowledgedWarnings: unacknowledged,
      });
    }

    // 3. Another session released a newer version of this UI meanwhile?
    const head = versionRef(ctx, uiView.headVersionId);
    const base = versionRef(ctx, session.baseVersionId);
    const headMoved = (head?.id ?? null) !== (base?.id ?? null);
    if (headMoved && !input.conflictAcknowledged) {
      throw new OpsisError('VERSION_CONFLICT', 'A newer version of this UI was released meanwhile', {
        headVersion: head,
        baseVersion: base,
      });
    }

    const screenshots = ctx.repos.screenshots.list({ projectId: session.projectId, sessionId });
    const warningIds = new Set(report.warnings.map((warning) => warning.id));
    const snapshot = buildSnapshot({
      project,
      uiView,
      session,
      baseVersion: base,
      screenshots,
      draft,
      completeness: report,
      // Store only acknowledgements that refer to an actual warning.
      acknowledgedWarnings: input.acknowledgedWarnings.filter((id) => warningIds.has(id)),
    });

    // 4. Component revisions, deduplicated by content hash.
    const componentRevisionIds = new Map<string, string>();
    for (const component of snapshot.components) {
      const content = canonicalJson(componentContent(component));
      const contentSha256 = ctx.hash.sha256(content);
      let revision = ctx.repos.versions.findComponentRevision(component.componentId, contentSha256);
      if (!revision) {
        revision = {
          id: newId('componentRevision'),
          componentId: component.componentId,
          contentSha256,
          content,
          createdAt: uow.now,
        };
        ctx.repos.versions.insertComponentRevision(revision);
      }
      componentRevisionIds.set(component.componentId, revision.id);
    }

    // 5./6. Spec revision with its component tree.
    const headVersion = head === null ? undefined : ctx.repos.versions.findUiVersion(head.id);
    const snapshotJson = canonicalJson(snapshot);
    const specRevision: SpecRevision = {
      id: newId('specRevision'),
      projectId: session.projectId,
      uiViewId: uiView.id,
      sessionId,
      revisionNo: ctx.repos.versions.nextRevisionNo(uiView.id),
      snapshot: snapshotJson,
      snapshotSha256: ctx.hash.sha256(snapshotJson),
      completeness: report,
      acknowledgedIssues: snapshot.acknowledgedWarnings,
      previousSpecRevisionId: headVersion?.specRevisionId ?? null,
      releasedBy: actorRef(actor),
      releasedAt: uow.now,
    };
    ctx.repos.versions.insertSpecRevision(specRevision);
    for (const component of snapshot.components) {
      ctx.repos.versions.insertSpecRevisionComponent({
        specRevisionId: specRevision.id,
        componentRevisionId: componentRevisionIds.get(component.componentId) ?? '',
        componentId: component.componentId,
        parentComponentId: component.parentId,
        order: component.order,
      });
    }

    // 7. Prompt, referencing the UI version and spec revision created here.
    const uiVersionId = newId('uiVersion');
    const references: ReleaseReferences = {
      uiVersionId,
      versionNo: ctx.repos.versions.nextVersionNo(uiView.id),
      specRevisionId: specRevision.id,
      revisionNo: specRevision.revisionNo,
      predecessor: head,
      releasedAt: uow.now,
      releasedBy: actorRef(actor),
      changeDescription: input.changeDescription.trim(),
    };
    const markdown = generatePrompt(snapshot, references);
    const promptVersion: PromptVersion = {
      id: newId('promptVersion'),
      specRevisionId: specRevision.id,
      generatorVersion: GENERATOR_VERSION,
      markdown,
      sha256: ctx.hash.sha256(markdown),
      createdAt: uow.now,
    };
    ctx.repos.versions.insertPromptVersion(promptVersion);

    // 8. UI version.
    const uiVersion: UiVersion = {
      id: uiVersionId,
      projectId: session.projectId,
      uiViewId: uiView.id,
      versionNo: references.versionNo,
      screenshotId: snapshot.primaryScreenshotId,
      screenshotIds: snapshot.screenshots.map((screenshot) => screenshot.id),
      specRevisionId: specRevision.id,
      promptVersionId: promptVersion.id,
      sessionId,
      predecessorVersionId: head?.id ?? null,
      pathAtVersion: uiView.path,
      changeDescription: references.changeDescription,
      createdBy: actorRef(actor),
      createdAt: uow.now,
    };
    ctx.repos.versions.insertUiVersion(uiVersion);

    // 9. New head; session → ready with its result.
    ctx.repos.uiViews.update({ ...uiView, headVersionId: uiVersion.id, updatedAt: uow.now });
    const updated = transitionSession(
      ctx,
      actor,
      uow,
      session,
      'ready',
      `released as V${String(uiVersion.versionNo)}`,
      {
        resultVersionId: uiVersion.id,
      },
    );

    // 10. Audit and events (published after commit).
    uow.audit({
      projectId: session.projectId,
      entityType: 'ui_version',
      entityId: uiVersion.id,
      action: 'release',
      data: {
        sessionId,
        versionNo: uiVersion.versionNo,
        specRevisionId: specRevision.id,
        promptVersionId: promptVersion.id,
        acknowledgedWarnings: snapshot.acknowledgedWarnings,
        ...(headMoved
          ? {
              basedOn: base?.versionNo ?? null,
              conflictAcknowledged: true,
              predecessor: head?.versionNo ?? null,
            }
          : {}),
      },
    });
    uow.emit({
      type: 'UiVersionCreated',
      projectId: session.projectId,
      uiViewId: uiView.id,
      sessionId,
      versionId: uiVersion.id,
      versionNo: uiVersion.versionNo,
    });
    uow.emit({ type: 'UiViewChanged', projectId: session.projectId, uiViewId: uiView.id });
    return { session: updated, uiVersion, specRevision, promptVersion };
  });
};

/**
 * Human reopens a released session before delivery (ready → in_progress, 04 §1). The
 * released version stays in the history; the next release builds on it.
 */
export const reopenSession = (ctx: AppContext, actor: Actor, sessionId: string, reason: string): Session =>
  commit(ctx, actor, (uow) => {
    const session = findSession(ctx, actor, sessionId);
    const updated = transitionSession(
      ctx,
      actor,
      uow,
      session,
      'in_progress',
      reason.slice(0, 2000) || 'reopened',
      {
        baseVersionId: session.resultVersionId,
        resultVersionId: null,
      },
    );
    uow.audit({
      projectId: session.projectId,
      entityType: 'session',
      entityId: sessionId,
      action: 'reopen',
      data: { reason, releasedVersionId: session.resultVersionId },
    });
    return updated;
  });
