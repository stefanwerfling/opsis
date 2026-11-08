/**
 * Revision of an existing UI (architecture 05 §3). The draft of a revision session starts
 * as a copy of the base version with the **same component ids**, so components can be
 * compared across versions. Regions still point to the screenshots of the base version
 * until the human has checked them against the new screenshot (`inherited_region`).
 */
import type { Draft, DraftComponent } from './draft.js';
import { clampRect, type Rect, type Size } from './geometry.js';
import type { SpecSnapshot } from './specification/snapshot.js';

/**
 * Carries over everything that describes the UI: components (tree, names, kinds, spec,
 * regions), relations, goal, global acceptance criteria and open questions. Not carried
 * over: the change summary (describes the previous change) and conflicts (all were
 * resolved for the release; their resolutions stay in the base version).
 */
export const draftFromSnapshot = (sessionId: string, snapshot: SpecSnapshot, at: string): Draft => ({
  sessionId,
  revision: 0,
  goal: snapshot.goal,
  changeSummary: '',
  acceptance: [...snapshot.acceptance],
  openQuestions: [...snapshot.openQuestions],
  components: snapshot.components.map((component): DraftComponent => ({
    componentId: component.componentId,
    parentId: component.parentId,
    order: component.order,
    name: component.name,
    kind: component.kind,
    hidden: false,
    spec: component.spec,
    regions: component.regions.map((region) => ({ ...region })),
  })),
  relations: snapshot.relations.map((relation) => ({ ...relation })),
  conflicts: [],
  updatedAt: at,
});

/**
 * Proposal for an inherited region on the new screenshot: scaled by the width ratio (pages
 * usually keep their layout width and grow in height) and clamped to the new image. Only a
 * starting point – the human confirms or adjusts it.
 */
export const transferRect = (rect: Rect, from: Size, to: Size): Rect => {
  const scale = from.width > 0 ? to.width / from.width : 1;
  return clampRect(
    { x: rect.x * scale, y: rect.y * scale, width: rect.width * scale, height: rect.height * scale },
    to,
  );
};
