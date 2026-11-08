/**
 * Component proposals by an agent (E9, revised): before the human starts the review, a
 * connected agent may describe what it sees on the screenshots. The proposals land in the
 * draft as ordinary components; every specification value carries the origin
 * `auto_detected`, so the completeness check flags it until the human confirms or rewrites
 * it. Agents still never edit a draft under review and never release (principle 10).
 */
import { z } from 'zod';
import type { Actor } from '../domain/actor.js';
import { applyDraftOperations, emptyDraft, type Draft, type DraftOperation } from '../domain/draft.js';
import { OpsisError } from '../domain/errors.js';
import { newId } from '../domain/ids.js';
import {
  COMPONENT_KINDS,
  DRAFT_LIMITS,
  SPEC_GROUPS,
  SPEC_GROUP_NAMES,
  type SpecGroup,
} from '../domain/vocabulary.js';
import { commit, parseInput, type AppContext } from './context.js';
import { findSession } from './sessions.js';

/** Components per call; several calls may follow each other while the review has not started. */
export const MAX_PROPOSED_COMPONENTS = 300;

const Ref = z.string().min(1).max(64);
const Text = z.string().trim().min(1).max(DRAFT_LIMITS.maxTextLength);

/** `{ general: { description: "…" }, interaction: { click: "…" } }` – only known fields. */
const ProposedSpecSchema = z.strictObject(
  Object.fromEntries(
    SPEC_GROUP_NAMES.map((group) => [
      group,
      z
        .strictObject(Object.fromEntries(SPEC_GROUPS[group].map((field) => [field, Text.optional()])))
        .optional(),
    ]),
  ) as Record<SpecGroup, z.ZodOptional<z.ZodObject<Record<string, z.ZodOptional<typeof Text>>>>>,
);

const ProposedComponentSchema = z.strictObject({
  /** The agent's own reference, unique within the call (used by `parentRef`). */
  ref: Ref,
  /** Parent proposed earlier in the same call … */
  parentRef: Ref.optional(),
  /** … or an existing component of the draft. Neither: top level. */
  parentId: z.string().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(DRAFT_LIMITS.maxNameLength),
  kind: z.enum(COMPONENT_KINDS).default('component'),
  /** Marking in original screenshot pixels; clamped to the image. */
  region: z
    .strictObject({
      screenshotId: z.string().min(1).max(64),
      x: z.number(),
      y: z.number(),
      width: z.number().positive(),
      height: z.number().positive(),
    })
    .optional(),
  spec: ProposedSpecSchema.optional(),
});

export const ProposeComponentsInputSchema = z.strictObject({
  components: z.array(ProposedComponentSchema).min(1).max(MAX_PROPOSED_COMPONENTS),
});
export type ProposeComponentsInput = z.input<typeof ProposeComponentsInputSchema>;

export interface ProposeComponentsResult {
  readonly draft: Draft;
  /** Agent reference → created component id, in input order. */
  readonly created: readonly { readonly ref: string; readonly componentId: string }[];
  readonly specValues: number;
}

export const proposeComponents = (
  ctx: AppContext,
  actor: Actor,
  sessionId: string,
  input: unknown,
): ProposeComponentsResult => {
  const data = parseInput(ProposeComponentsInputSchema, input);
  if (actor.type !== 'agent') {
    throw new OpsisError('FORBIDDEN_ACTOR', 'Proposals come from agents; humans edit the draft directly');
  }
  return commit(ctx, actor, (uow) => {
    const session = findSession(ctx, actor, sessionId);
    if (session.status !== 'awaiting_review') {
      throw new OpsisError(
        'INVALID_TRANSITION',
        session.status === 'in_progress'
          ? 'The human has started the review; proposals are only accepted before that'
          : `Proposals are only accepted while the session is "awaiting_review" (now "${session.status}")`,
        { sessionId: session.id, status: session.status },
      );
    }
    const current = ctx.repos.drafts.find(session.id) ?? emptyDraft(session.id, session.createdAt);
    if (current.components.length + data.components.length > DRAFT_LIMITS.maxComponents) {
      throw new OpsisError(
        'VALIDATION',
        `A draft holds at most ${String(DRAFT_LIMITS.maxComponents)} components`,
      );
    }

    const ids = new Map<string, string>();
    const operations: DraftOperation[] = [];
    let specValues = 0;
    data.components.forEach((component, index) => {
      const at = (message: string) =>
        new OpsisError('VALIDATION', `components[${String(index)}]: ${message}`, {
          index,
          ref: component.ref,
        });
      if (ids.has(component.ref)) throw at(`duplicate ref "${component.ref}"`);
      if (component.parentRef !== undefined && component.parentId !== undefined) {
        throw at('give either parentRef or parentId, not both');
      }
      let parentId: string | null = component.parentId ?? null;
      if (component.parentRef !== undefined) {
        const parent = ids.get(component.parentRef);
        if (parent === undefined)
          throw at(`parentRef "${component.parentRef}" must refer to an earlier component`);
        parentId = parent;
      }
      const componentId = newId('component');
      ids.set(component.ref, componentId);
      operations.push({
        op: 'addComponent',
        componentId,
        parentId,
        name: component.name,
        kind: component.kind,
        ...(component.region === undefined
          ? {}
          : {
              region: {
                screenshotId: component.region.screenshotId,
                x: component.region.x,
                y: component.region.y,
                width: component.region.width,
                height: component.region.height,
              },
            }),
      });
      for (const group of SPEC_GROUP_NAMES) {
        for (const [field, value] of Object.entries(component.spec?.[group] ?? {})) {
          if (value === undefined) continue;
          specValues += 1;
          operations.push({
            op: 'setSpecValue',
            componentId,
            group,
            field,
            value: { value, origin: 'auto_detected' },
          });
        }
      }
    });

    const screenshots = ctx.repos.screenshots
      .list({ projectId: session.projectId, sessionId: session.id })
      .map((screenshot) => ({ id: screenshot.id, width: screenshot.width, height: screenshot.height }));
    const changed: Draft = {
      ...applyDraftOperations(current, operations, { screenshots }),
      revision: current.revision + 1,
      updatedAt: uow.now,
    };
    ctx.repos.drafts.save(changed);
    uow.audit({
      projectId: session.projectId,
      entityType: 'draft',
      entityId: session.id,
      action: 'propose',
      data: { revision: changed.revision, components: ids.size, specValues },
    });
    uow.emit({
      type: 'DraftChanged',
      projectId: session.projectId,
      sessionId: session.id,
      revision: changed.revision,
    });
    return {
      draft: changed,
      created: [...ids].map(([ref, componentId]) => ({ ref, componentId })),
      specValues,
    };
  });
};
