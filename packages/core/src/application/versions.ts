/**
 * Reading released history: UI versions, specifications and prompts. Nothing here is
 * ever generated from a draft – before a release there is nothing to read (NOT_READY),
 * so an unfinished state is never handed out (architecture 06 §3).
 */
import { z } from 'zod';
import type { Actor } from '../domain/actor.js';
import { OpsisError } from '../domain/errors.js';
import type { Session } from '../domain/session.js';
import { renderSpecificationMarkdown } from '../domain/specification/markdown.js';
import {
  buildSpecificationDocument,
  type ReleaseReferences,
  type SpecSnapshot,
} from '../domain/specification/snapshot.js';
import type { PromptVersion, SpecRevision, UiVersion } from '../domain/version.js';
import { commit, parseInput, type AppContext } from './context.js';
import { findSession, transitionSession } from './sessions.js';

export interface ReleasedVersion {
  readonly uiVersion: UiVersion;
  readonly specRevision: SpecRevision;
  readonly promptVersion: PromptVersion;
  readonly snapshot: SpecSnapshot;
  readonly references: ReleaseReferences;
}

/** Either a session (its released result) or a UI version directly. */
export const VersionRefSchema = z.union([
  z.strictObject({ sessionId: z.string().min(1).max(64) }),
  z.strictObject({ versionId: z.string().min(1).max(64) }),
]);
export type VersionRefInput = z.input<typeof VersionRefSchema>;

const loadVersion = (ctx: AppContext, uiVersion: UiVersion): ReleasedVersion => {
  const specRevision = ctx.repos.versions.findSpecRevision(uiVersion.specRevisionId);
  const promptVersion = ctx.repos.versions.findPromptVersion(uiVersion.promptVersionId);
  if (!specRevision || !promptVersion) {
    throw new OpsisError('NOT_FOUND', `History of version "${uiVersion.id}" is incomplete`);
  }
  const predecessor =
    uiVersion.predecessorVersionId === null
      ? undefined
      : ctx.repos.versions.findUiVersion(uiVersion.predecessorVersionId);
  return {
    uiVersion,
    specRevision,
    promptVersion,
    // Written by the release from a validated snapshot; stored as canonical JSON.
    snapshot: JSON.parse(specRevision.snapshot) as SpecSnapshot,
    references: {
      uiVersionId: uiVersion.id,
      versionNo: uiVersion.versionNo,
      specRevisionId: specRevision.id,
      revisionNo: specRevision.revisionNo,
      predecessor: predecessor ? { id: predecessor.id, versionNo: predecessor.versionNo } : null,
      releasedAt: specRevision.releasedAt,
      releasedBy: specRevision.releasedBy,
      changeDescription: uiVersion.changeDescription,
    },
  };
};

/** Snapshot of a released version, without access check (callers checked the project). */
export const storedSnapshot = (ctx: AppContext, uiVersionId: string): SpecSnapshot => {
  const version = ctx.repos.versions.findUiVersion(uiVersionId);
  if (!version) throw new OpsisError('NOT_FOUND', `UI version "${uiVersionId}" not found`);
  return loadVersion(ctx, version).snapshot;
};

const findVersion = (ctx: AppContext, actor: Actor, versionId: string): UiVersion => {
  const version = ctx.repos.versions.findUiVersion(versionId);
  if (!version || !ctx.access.canAccessProject(actor, version.projectId)) {
    throw new OpsisError('NOT_FOUND', `UI version "${versionId}" not found`);
  }
  return version;
};

const releasedOf = (ctx: AppContext, session: Session): UiVersion => {
  if ((session.status !== 'ready' && session.status !== 'delivered') || session.resultVersionId === null) {
    throw new OpsisError('NOT_READY', 'The specification of this session has not been released yet', {
      sessionId: session.id,
      status: session.status,
    });
  }
  const version = ctx.repos.versions.findUiVersion(session.resultVersionId);
  if (!version) throw new OpsisError('NOT_FOUND', `UI version "${session.resultVersionId}" not found`);
  return version;
};

export const getUiVersion = (ctx: AppContext, actor: Actor, versionId: string): ReleasedVersion =>
  loadVersion(ctx, findVersion(ctx, actor, versionId));

export const listUiVersions = (ctx: AppContext, actor: Actor, uiViewId: string): UiVersion[] => {
  const view = ctx.repos.uiViews.findById(uiViewId);
  if (!view || !ctx.access.canAccessProject(actor, view.projectId)) {
    throw new OpsisError('NOT_FOUND', `UI view "${uiViewId}" not found`);
  }
  return ctx.repos.versions.listUiVersions(uiViewId);
};

const resolve = (ctx: AppContext, actor: Actor, raw: unknown): { version: UiVersion } => {
  const ref = parseInput(VersionRefSchema, raw);
  if ('sessionId' in ref) {
    const session = findSession(ctx, actor, ref.sessionId);
    return { version: releasedOf(ctx, session) };
  }
  return { version: findVersion(ctx, actor, ref.versionId) };
};

export const SPEC_FORMATS = ['json', 'markdown'] as const;
export type SpecFormat = (typeof SPEC_FORMATS)[number];

export interface SpecificationResult {
  readonly format: SpecFormat;
  /** JSON document (format json) or Markdown text (format markdown). */
  readonly content: unknown;
  readonly references: ReleaseReferences;
}

/** The released specification (requirements §10 outputs 1–9), regenerated from the immutable snapshot. */
export const getSpecification = (
  ctx: AppContext,
  actor: Actor,
  ref: unknown,
  format: SpecFormat,
): SpecificationResult => {
  const released = loadVersion(ctx, resolve(ctx, actor, ref).version);
  return {
    format,
    content:
      format === 'json'
        ? buildSpecificationDocument(
            released.snapshot,
            released.references,
            released.promptVersion.generatorVersion,
          )
        : renderSpecificationMarkdown(released.snapshot, released.references),
    references: released.references,
  };
};

export interface ImplementationPrompt {
  readonly markdown: string;
  readonly uiVersionId: string;
  readonly versionNo: number;
  readonly specRevisionId: string;
  readonly promptVersionId: string;
}

/**
 * The prompt stored at release time. The first retrieval by an agent marks the session
 * as delivered (decision E3); later calls return the same prompt version.
 */
export const getImplementationPrompt = (
  ctx: AppContext,
  actor: Actor,
  ref: unknown,
): ImplementationPrompt => {
  const { version } = resolve(ctx, actor, ref);
  const released = loadVersion(ctx, version);
  if (actor.type === 'agent') {
    commit(ctx, actor, (uow) => {
      // Read inside the transaction: the session the version was released from.
      const session = ctx.repos.sessions.findById(version.sessionId);
      if (session?.status === 'ready' && session.resultVersionId === version.id) {
        transitionSession(ctx, actor, uow, session, 'delivered', 'prompt retrieved');
      }
    });
  }
  return {
    markdown: released.promptVersion.markdown,
    uiVersionId: version.id,
    versionNo: version.versionNo,
    specRevisionId: released.specRevision.id,
    promptVersionId: released.promptVersion.id,
  };
};
