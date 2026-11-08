import { z } from 'zod';
import type { Actor } from '../domain/actor.js';
import { applyDraftOperations, emptyDraft, type Draft, type DraftOperation } from '../domain/draft.js';
import { OpsisError } from '../domain/errors.js';
import {
  COMPONENT_KINDS,
  DRAFT_LIMITS,
  RELATION_KINDS,
  SPEC_GROUP_NAMES,
  SPEC_ORIGINS,
  type SpecGroup,
} from '../domain/vocabulary.js';
import { commit, parseInput, type AppContext } from './context.js';
import { findSession, transitionSession } from './sessions.js';

// ── Input schemas (shape only; semantics are checked by applyDraftOperations) ──

const Id = z.string().min(1).max(64);
const Text = z.string().max(DRAFT_LIMITS.maxTextLength);
const Name = z.string().max(DRAFT_LIMITS.maxNameLength);
const Coordinate = z.number().min(-1e6).max(1e6);
const RectSchema = z.strictObject({ x: Coordinate, y: Coordinate, width: Coordinate, height: Coordinate });
const TextList = z.array(Text).max(DRAFT_LIMITS.maxListItems);

const SpecValueSchema = z.strictObject({
  value: Text,
  origin: z.enum(SPEC_ORIGINS),
  note: Text.optional(),
});

export const DraftOperationSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('addComponent'),
    componentId: Id,
    parentId: Id.nullable(),
    index: z.number().int().min(0).optional(),
    name: Name,
    kind: z.enum(COMPONENT_KINDS),
    region: RectSchema.extend({ screenshotId: Id }).strict().optional(),
  }),
  z.strictObject({
    op: z.literal('updateComponent'),
    componentId: Id,
    name: Name.optional(),
    kind: z.enum(COMPONENT_KINDS).optional(),
    hidden: z.boolean().optional(),
  }),
  z.strictObject({
    op: z.literal('moveComponent'),
    componentId: Id,
    parentId: Id.nullable(),
    index: z.number().int().min(0),
  }),
  z.strictObject({
    op: z.literal('duplicateComponent'),
    componentId: Id,
    idMap: z.record(Id, Id),
  }),
  z.strictObject({ op: z.literal('deleteComponent'), componentId: Id }),
  z.strictObject({
    op: z.literal('setRegion'),
    componentId: Id,
    screenshotId: Id,
    rect: RectSchema.nullable(),
  }),
  z.strictObject({
    op: z.literal('setSpecValue'),
    componentId: Id,
    group: z.enum(SPEC_GROUP_NAMES as [SpecGroup, ...SpecGroup[]]),
    field: z.string().min(1).max(64),
    value: SpecValueSchema.nullable(),
  }),
  z.strictObject({
    op: z.literal('addRelation'),
    relationId: Id,
    fromComponentId: Id,
    toComponentId: Id,
    kind: z.enum(RELATION_KINDS),
    description: Text.default(''),
  }),
  z.strictObject({
    op: z.literal('updateRelation'),
    relationId: Id,
    kind: z.enum(RELATION_KINDS).optional(),
    description: Text.optional(),
  }),
  z.strictObject({ op: z.literal('deleteRelation'), relationId: Id }),
  z.strictObject({
    op: z.literal('updateDraft'),
    goal: Text.optional(),
    changeSummary: Text.optional(),
    acceptance: TextList.optional(),
    openQuestions: TextList.optional(),
  }),
]);

export const ChangeDraftInputSchema = z.strictObject({
  /** The draft revision the client based its operations on (optimistic locking). */
  baseRevision: z.number().int().min(0),
  operations: z.array(DraftOperationSchema).min(1).max(DRAFT_LIMITS.maxOperationsPerRequest),
});
export type ChangeDraftInput = z.input<typeof ChangeDraftInputSchema>;

// ── Use cases ─────────────────────────────────────────────────────────────────

export const getDraft = (ctx: AppContext, actor: Actor, sessionId: string): Draft => {
  const session = findSession(ctx, actor, sessionId);
  return ctx.repos.drafts.find(session.id) ?? emptyDraft(session.id, session.createdAt);
};

/**
 * Applies a batch of editor operations. Only a human edits drafts (agents submit
 * screenshots, humans specify – principle 10). The first edit of a session that is still
 * `awaiting_review` starts the review (architecture 04: "Mensch öffnet/editiert").
 */
export const changeDraft = (ctx: AppContext, actor: Actor, sessionId: string, input: unknown): Draft => {
  const data = parseInput(ChangeDraftInputSchema, input);
  if (actor.type !== 'human') {
    throw new OpsisError('FORBIDDEN_ACTOR', 'Only a human can edit the specification draft');
  }
  return commit(ctx, actor, (uow) => {
    let session = findSession(ctx, actor, sessionId);
    if (session.status === 'awaiting_review') {
      session = transitionSession(ctx, actor, uow, session, 'in_progress', 'first edit');
    }
    if (session.status !== 'in_progress') {
      throw new OpsisError(
        'CONFLICT',
        `The draft of a session in status "${session.status}" cannot be edited`,
        {
          status: session.status,
        },
      );
    }
    const current = ctx.repos.drafts.find(session.id) ?? emptyDraft(session.id, session.createdAt);
    if (current.revision !== data.baseRevision) {
      throw new OpsisError('VERSION_CONFLICT', 'The draft was changed in the meantime', {
        currentRevision: current.revision,
      });
    }
    const screenshots = ctx.repos.screenshots
      .list({ projectId: session.projectId, sessionId: session.id })
      .map((screenshot) => ({ id: screenshot.id, width: screenshot.width, height: screenshot.height }));

    const changed: Draft = {
      ...applyDraftOperations(current, data.operations as DraftOperation[], { screenshots }),
      revision: current.revision + 1,
      updatedAt: uow.now,
    };
    ctx.repos.drafts.save(changed);
    uow.audit({
      projectId: session.projectId,
      entityType: 'draft',
      entityId: session.id,
      action: 'change',
      data: { revision: changed.revision, operations: data.operations.map((operation) => operation.op) },
    });
    uow.emit({
      type: 'DraftChanged',
      projectId: session.projectId,
      sessionId: session.id,
      revision: changed.revision,
    });
    return changed;
  });
};
