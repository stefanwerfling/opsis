/**
 * Draft of a session: the mutable working copy the human edits (architecture 02/05).
 *
 * All changes go through `applyDraftOperations`, a pure function used by the server (the
 * authority) and by the browser (optimistic local state). It is deliberately free of zod
 * and IO; the shape of untrusted input is validated by the application layer before.
 */
import { OpsisError } from './errors.js';
import { clampRect, type Rect, type Size } from './geometry.js';
import { hasIdPrefix } from './ids.js';
import {
  COMPONENT_KINDS,
  CONFLICT_STATUSES,
  DRAFT_LIMITS,
  RELATION_KINDS,
  SPEC_GROUPS,
  type ComponentKind,
  type ConflictStatus,
  type RelationKind,
  type SpecField,
  type SpecGroup,
  type SpecOrigin,
} from './vocabulary.js';

export interface SpecValue {
  readonly value: string;
  readonly origin: SpecOrigin;
  readonly note?: string;
}

/** Missing groups/fields mean "not specified" – there are no defaults (requirements §6). */
export type ComponentSpec = {
  readonly [G in SpecGroup]?: { readonly [F in SpecField<G>]?: SpecValue };
};

export interface Region extends Rect {
  readonly screenshotId: string;
}

export interface DraftComponent {
  readonly componentId: string;
  /** Semantic parent chosen by the user – never derived from geometry. */
  readonly parentId: string | null;
  readonly order: number;
  readonly name: string;
  readonly kind: ComponentKind;
  /** Editor visibility only, no domain meaning. */
  readonly hidden: boolean;
  readonly spec: ComponentSpec;
  /** At most one region per screenshot, in original screenshot pixels. */
  readonly regions: readonly Region[];
}

export interface Relation {
  readonly id: string;
  readonly fromComponentId: string;
  readonly toComponentId: string;
  readonly kind: RelationKind;
  readonly description: string;
}

/**
 * A contradiction recorded by the human (architecture 02 §3, way 1). Open conflicts block
 * the release; a resolved conflict keeps its resolution so the decision stays traceable.
 */
export interface Conflict {
  readonly id: string;
  /** Components involved (may be empty for draft-wide contradictions). */
  readonly componentIds: readonly string[];
  readonly description: string;
  readonly status: ConflictStatus;
  /** How the human resolved it; empty while open. */
  readonly resolution: string;
}

export interface Draft {
  readonly sessionId: string;
  /** Incremented with every saved change; used for optimistic locking. */
  readonly revision: number;
  readonly goal: string;
  readonly changeSummary: string;
  readonly acceptance: readonly string[];
  readonly openQuestions: readonly string[];
  /** Components in tree order (parents before children, siblings by `order`). */
  readonly components: readonly DraftComponent[];
  readonly relations: readonly Relation[];
  readonly conflicts: readonly Conflict[];
  readonly updatedAt: string;
}

export type DraftOperation =
  | {
      readonly op: 'addComponent';
      readonly componentId: string;
      readonly parentId: string | null;
      /** Position among the siblings; appended when omitted. */
      readonly index?: number;
      readonly name: string;
      readonly kind: ComponentKind;
      readonly region?: Region;
    }
  | {
      readonly op: 'updateComponent';
      readonly componentId: string;
      readonly name?: string;
      readonly kind?: ComponentKind;
      readonly hidden?: boolean;
    }
  | {
      readonly op: 'moveComponent';
      readonly componentId: string;
      readonly parentId: string | null;
      readonly index: number;
    }
  | {
      readonly op: 'duplicateComponent';
      readonly componentId: string;
      /** New id for every component of the subtree (old id → new id). */
      readonly idMap: Readonly<Record<string, string>>;
    }
  | { readonly op: 'deleteComponent'; readonly componentId: string }
  | {
      readonly op: 'setRegion';
      readonly componentId: string;
      readonly screenshotId: string;
      /** `null` removes the region on this screenshot. */
      readonly rect: Rect | null;
    }
  | {
      readonly op: 'setSpecValue';
      readonly componentId: string;
      readonly group: SpecGroup;
      readonly field: string;
      /** `null` (or an empty value) removes the field: it becomes "not specified" again. */
      readonly value: SpecValue | null;
    }
  | {
      readonly op: 'addRelation';
      readonly relationId: string;
      readonly fromComponentId: string;
      readonly toComponentId: string;
      readonly kind: RelationKind;
      readonly description: string;
    }
  | {
      readonly op: 'updateRelation';
      readonly relationId: string;
      readonly kind?: RelationKind;
      readonly description?: string;
    }
  | { readonly op: 'deleteRelation'; readonly relationId: string }
  | {
      readonly op: 'addConflict';
      readonly conflictId: string;
      readonly componentIds: readonly string[];
      readonly description: string;
    }
  | {
      readonly op: 'updateConflict';
      readonly conflictId: string;
      readonly componentIds?: readonly string[];
      readonly description?: string;
      readonly status?: ConflictStatus;
      readonly resolution?: string;
    }
  | { readonly op: 'deleteConflict'; readonly conflictId: string }
  | {
      readonly op: 'updateDraft';
      readonly goal?: string;
      readonly changeSummary?: string;
      readonly acceptance?: readonly string[];
      readonly openQuestions?: readonly string[];
    };

export interface DraftContext {
  /** Screenshots of the session; regions may only refer to these. */
  readonly screenshots: readonly (Size & { readonly id: string })[];
}

export const emptyDraft = (sessionId: string, at: string): Draft => ({
  sessionId,
  revision: 0,
  goal: '',
  changeSummary: '',
  acceptance: [],
  openQuestions: [],
  components: [],
  relations: [],
  conflicts: [],
  updatedAt: at,
});

// ── Read helpers ──────────────────────────────────────────────────────────────

export const findComponent = (draft: Draft, componentId: string): DraftComponent | undefined =>
  draft.components.find((component) => component.componentId === componentId);

/** Children of `parentId` (null = roots), ordered. */
export const childrenOf = (draft: Draft, parentId: string | null): DraftComponent[] =>
  draft.components.filter((component) => component.parentId === parentId).sort((a, b) => a.order - b.order);

/** The component and all its descendants, in tree order. */
export const subtreeIds = (draft: Draft, componentId: string): string[] => {
  const result: string[] = [];
  const visit = (id: string): void => {
    result.push(id);
    for (const child of childrenOf(draft, id)) visit(child.componentId);
  };
  if (findComponent(draft, componentId)) visit(componentId);
  return result;
};

/** Depth of every component (roots = 0); used for hierarchy colours. */
export const componentDepths = (draft: Draft): Map<string, number> => {
  const depths = new Map<string, number>();
  for (const component of draft.components) {
    const parentDepth = component.parentId === null ? -1 : (depths.get(component.parentId) ?? 0);
    depths.set(component.componentId, parentDepth + 1);
  }
  return depths;
};

export const regionOn = (component: DraftComponent, screenshotId: string): Region | undefined =>
  component.regions.find((region) => region.screenshotId === screenshotId);

// ── Operations ────────────────────────────────────────────────────────────────

interface MutableComponent {
  componentId: string;
  parentId: string | null;
  order: number;
  name: string;
  kind: ComponentKind;
  hidden: boolean;
  spec: Record<string, Record<string, SpecValue>>;
  regions: Region[];
}

interface MutableDraft {
  goal: string;
  changeSummary: string;
  acceptance: string[];
  openQuestions: string[];
  components: Map<string, MutableComponent>;
  relations: Map<string, Relation>;
  conflicts: Map<string, Conflict>;
}

const invalid = (index: number, message: string): OpsisError =>
  new OpsisError('VALIDATION', `Operation ${String(index)}: ${message}`, { operationIndex: index });

const checkName = (index: number, name: string): string => {
  const trimmed = name.trim();
  if (trimmed === '') throw invalid(index, 'name must not be empty');
  if (trimmed.length > DRAFT_LIMITS.maxNameLength) throw invalid(index, 'name is too long');
  return trimmed;
};

const checkText = (index: number, text: string, what: string): string => {
  if (text.length > DRAFT_LIMITS.maxTextLength) throw invalid(index, `${what} is too long`);
  return text;
};

const checkList = (index: number, items: readonly string[], what: string): string[] => {
  const cleaned = items.map((item) => item.trim()).filter((item) => item !== '');
  if (cleaned.length > DRAFT_LIMITS.maxListItems) throw invalid(index, `too many ${what}`);
  for (const item of cleaned) checkText(index, item, what);
  return cleaned;
};

const toMutable = (draft: Draft): MutableDraft => ({
  goal: draft.goal,
  changeSummary: draft.changeSummary,
  acceptance: [...draft.acceptance],
  openQuestions: [...draft.openQuestions],
  components: new Map(
    draft.components.map((component) => [
      component.componentId,
      {
        ...component,
        spec: Object.fromEntries(
          Object.entries(component.spec).map(([group, fields]) => [group, { ...fields }]),
        ),
        regions: [...component.regions],
      },
    ]),
  ),
  relations: new Map(draft.relations.map((relation) => [relation.id, relation])),
  conflicts: new Map(draft.conflicts.map((conflict) => [conflict.id, conflict])),
});

const siblings = (state: MutableDraft, parentId: string | null): MutableComponent[] =>
  [...state.components.values()]
    .filter((component) => component.parentId === parentId)
    .sort((a, b) => a.order - b.order);

/** Places `component` at `index` among the children of `parentId` and renumbers 0..n-1. */
const placeAt = (
  state: MutableDraft,
  component: MutableComponent,
  parentId: string | null,
  index: number | undefined,
): void => {
  const oldParent = component.parentId;
  const list = siblings(state, parentId).filter((other) => other !== component);
  const position = index === undefined ? list.length : Math.max(0, Math.min(list.length, Math.trunc(index)));
  list.splice(position, 0, component);
  component.parentId = parentId;
  list.forEach((item, order) => {
    item.order = order;
  });
  if (oldParent !== parentId) renumber(state, oldParent);
};

const renumber = (state: MutableDraft, parentId: string | null): void => {
  siblings(state, parentId).forEach((item, order) => {
    item.order = order;
  });
};

const subtree = (state: MutableDraft, componentId: string): string[] => {
  const result: string[] = [];
  const visit = (id: string): void => {
    result.push(id);
    for (const child of siblings(state, id)) visit(child.componentId);
  };
  visit(componentId);
  return result;
};

const requireComponent = (state: MutableDraft, index: number, componentId: string): MutableComponent => {
  const component = state.components.get(componentId);
  if (!component) throw invalid(index, `unknown component "${componentId}"`);
  return component;
};

const requireParent = (state: MutableDraft, index: number, parentId: string | null): void => {
  if (parentId !== null) requireComponent(state, index, parentId);
};

const requireNewComponentId = (state: MutableDraft, index: number, componentId: string): void => {
  if (!hasIdPrefix(componentId, 'component')) throw invalid(index, `invalid component id "${componentId}"`);
  if (state.components.has(componentId)) throw invalid(index, `component "${componentId}" already exists`);
};

const checkKind = (index: number, kind: string): ComponentKind => {
  if (!(COMPONENT_KINDS as readonly string[]).includes(kind)) throw invalid(index, `unknown kind "${kind}"`);
  return kind as ComponentKind;
};

const checkRelationKind = (index: number, kind: string): RelationKind => {
  if (!(RELATION_KINDS as readonly string[]).includes(kind)) {
    throw invalid(index, `unknown relation kind "${kind}"`);
  }
  return kind as RelationKind;
};

const normalizeRegion = (index: number, context: DraftContext, screenshotId: string, rect: Rect): Region => {
  const screenshot = context.screenshots.find((candidate) => candidate.id === screenshotId);
  if (!screenshot) throw invalid(index, `screenshot "${screenshotId}" does not belong to this session`);
  const values = [rect.x, rect.y, rect.width, rect.height];
  if (!values.every(Number.isFinite)) throw invalid(index, 'region coordinates must be finite numbers');
  return { screenshotId, ...clampRect(rect, screenshot) };
};

const setRegion = (component: MutableComponent, region: Region | null, screenshotId: string): void => {
  component.regions = component.regions.filter((existing) => existing.screenshotId !== screenshotId);
  if (region !== null) component.regions.push(region);
  component.regions.sort((a, b) => a.screenshotId.localeCompare(b.screenshotId));
};

const checkConflictComponents = (
  state: MutableDraft,
  index: number,
  componentIds: readonly string[],
): string[] => {
  const unique = [...new Set(componentIds)];
  for (const id of unique) requireComponent(state, index, id);
  return unique;
};

const checkConflictStatus = (index: number, status: string): ConflictStatus => {
  if (!(CONFLICT_STATUSES as readonly string[]).includes(status)) {
    throw invalid(index, `unknown conflict status "${status}"`);
  }
  return status as ConflictStatus;
};

const requireDescription = (index: number, text: string): string => {
  const trimmed = text.trim();
  if (trimmed === '') throw invalid(index, 'a conflict needs a description');
  return checkText(index, trimmed, 'description');
};

const applyOne = (
  state: MutableDraft,
  operation: DraftOperation,
  index: number,
  context: DraftContext,
): void => {
  switch (operation.op) {
    case 'addComponent': {
      requireNewComponentId(state, index, operation.componentId);
      requireParent(state, index, operation.parentId);
      if (state.components.size >= DRAFT_LIMITS.maxComponents) throw invalid(index, 'too many components');
      const component: MutableComponent = {
        componentId: operation.componentId,
        parentId: operation.parentId,
        order: 0,
        name: checkName(index, operation.name),
        kind: checkKind(index, operation.kind),
        hidden: false,
        spec: {},
        regions: [],
      };
      if (operation.region !== undefined) {
        setRegion(
          component,
          normalizeRegion(index, context, operation.region.screenshotId, operation.region),
          operation.region.screenshotId,
        );
      }
      state.components.set(component.componentId, component);
      placeAt(state, component, operation.parentId, operation.index);
      return;
    }
    case 'updateComponent': {
      const component = requireComponent(state, index, operation.componentId);
      if (operation.name !== undefined) component.name = checkName(index, operation.name);
      if (operation.kind !== undefined) component.kind = checkKind(index, operation.kind);
      if (operation.hidden !== undefined) component.hidden = operation.hidden;
      return;
    }
    case 'moveComponent': {
      const component = requireComponent(state, index, operation.componentId);
      requireParent(state, index, operation.parentId);
      if (operation.parentId !== null && subtree(state, component.componentId).includes(operation.parentId)) {
        throw invalid(index, 'a component cannot be moved into itself or its descendants');
      }
      placeAt(state, component, operation.parentId, operation.index);
      return;
    }
    case 'duplicateComponent': {
      const original = requireComponent(state, index, operation.componentId);
      const ids = subtree(state, original.componentId);
      const mapped = Object.keys(operation.idMap);
      if (mapped.length !== ids.length || !ids.every((id) => id in operation.idMap)) {
        throw invalid(index, 'idMap must map exactly the components of the duplicated subtree');
      }
      const newIds = new Set<string>();
      for (const id of ids) {
        const newId = operation.idMap[id] ?? '';
        requireNewComponentId(state, index, newId);
        if (newIds.has(newId)) throw invalid(index, `duplicate new id "${newId}"`);
        newIds.add(newId);
      }
      if (state.components.size + ids.length > DRAFT_LIMITS.maxComponents) {
        throw invalid(index, 'too many components');
      }
      for (const id of ids) {
        const source = requireComponent(state, index, id);
        const copy: MutableComponent = {
          ...source,
          componentId: operation.idMap[id] ?? '',
          parentId:
            id === original.componentId ? source.parentId : (operation.idMap[source.parentId ?? ''] ?? null),
          spec: Object.fromEntries(
            Object.entries(source.spec).map(([group, fields]) => [group, { ...fields }]),
          ),
          regions: [...source.regions],
        };
        state.components.set(copy.componentId, copy);
      }
      const root = requireComponent(state, index, operation.idMap[original.componentId] ?? '');
      placeAt(state, root, original.parentId, original.order + 1);
      return;
    }
    case 'deleteComponent': {
      const component = requireComponent(state, index, operation.componentId);
      const removed = new Set(subtree(state, component.componentId));
      for (const id of removed) state.components.delete(id);
      for (const [id, relation] of state.relations) {
        if (removed.has(relation.fromComponentId) || removed.has(relation.toComponentId)) {
          state.relations.delete(id);
        }
      }
      // The conflict itself stays (the contradiction is still recorded), only the reference goes.
      for (const [id, conflict] of state.conflicts) {
        if (conflict.componentIds.some((componentId) => removed.has(componentId))) {
          state.conflicts.set(id, {
            ...conflict,
            componentIds: conflict.componentIds.filter((componentId) => !removed.has(componentId)),
          });
        }
      }
      renumber(state, component.parentId);
      return;
    }
    case 'setRegion': {
      const component = requireComponent(state, index, operation.componentId);
      const region =
        operation.rect === null
          ? null
          : normalizeRegion(index, context, operation.screenshotId, operation.rect);
      setRegion(component, region, operation.screenshotId);
      return;
    }
    case 'setSpecValue': {
      const component = requireComponent(state, index, operation.componentId);
      const fields: readonly string[] | undefined = (SPEC_GROUPS as Record<string, readonly string[]>)[
        operation.group
      ];
      if (fields === undefined) throw invalid(index, `unknown group "${operation.group}"`);
      if (!fields.includes(operation.field)) {
        throw invalid(index, `unknown field "${operation.field}" in group "${operation.group}"`);
      }
      const group = { ...(component.spec[operation.group] ?? {}) };
      const value = operation.value;
      if (value === null || value.value.trim() === '') {
        // Removing the value restores "not specified" – no empty strings pretending to be requirements.
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- field validated above
        delete group[operation.field];
      } else {
        const note = value.note?.trim() ?? '';
        group[operation.field] = {
          value: checkText(index, value.value, 'value'),
          origin: value.origin,
          ...(note === '' ? {} : { note: checkText(index, note, 'note') }),
        };
      }
      if (Object.keys(group).length === 0) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- group validated above
        delete component.spec[operation.group];
      } else {
        component.spec[operation.group] = group;
      }
      return;
    }
    case 'addRelation': {
      if (!hasIdPrefix(operation.relationId, 'relation')) {
        throw invalid(index, `invalid relation id "${operation.relationId}"`);
      }
      if (state.relations.has(operation.relationId)) throw invalid(index, 'relation already exists');
      if (state.relations.size >= DRAFT_LIMITS.maxRelations) throw invalid(index, 'too many relations');
      requireComponent(state, index, operation.fromComponentId);
      requireComponent(state, index, operation.toComponentId);
      if (operation.fromComponentId === operation.toComponentId) {
        throw invalid(index, 'a relation needs two different components');
      }
      state.relations.set(operation.relationId, {
        id: operation.relationId,
        fromComponentId: operation.fromComponentId,
        toComponentId: operation.toComponentId,
        kind: checkRelationKind(index, operation.kind),
        description: checkText(index, operation.description.trim(), 'description'),
      });
      return;
    }
    case 'updateRelation': {
      const relation = state.relations.get(operation.relationId);
      if (!relation) throw invalid(index, `unknown relation "${operation.relationId}"`);
      state.relations.set(relation.id, {
        ...relation,
        ...(operation.kind === undefined ? {} : { kind: checkRelationKind(index, operation.kind) }),
        ...(operation.description === undefined
          ? {}
          : { description: checkText(index, operation.description.trim(), 'description') }),
      });
      return;
    }
    case 'deleteRelation': {
      if (!state.relations.delete(operation.relationId)) {
        throw invalid(index, `unknown relation "${operation.relationId}"`);
      }
      return;
    }
    case 'addConflict': {
      if (!hasIdPrefix(operation.conflictId, 'conflict')) {
        throw invalid(index, `invalid conflict id "${operation.conflictId}"`);
      }
      if (state.conflicts.has(operation.conflictId)) throw invalid(index, 'conflict already exists');
      if (state.conflicts.size >= DRAFT_LIMITS.maxConflicts) throw invalid(index, 'too many conflicts');
      state.conflicts.set(operation.conflictId, {
        id: operation.conflictId,
        componentIds: checkConflictComponents(state, index, operation.componentIds),
        description: requireDescription(index, operation.description),
        status: 'open',
        resolution: '',
      });
      return;
    }
    case 'updateConflict': {
      const conflict = state.conflicts.get(operation.conflictId);
      if (!conflict) throw invalid(index, `unknown conflict "${operation.conflictId}"`);
      const status =
        operation.status === undefined ? conflict.status : checkConflictStatus(index, operation.status);
      const resolution =
        operation.resolution === undefined
          ? conflict.resolution
          : checkText(index, operation.resolution.trim(), 'resolution');
      if (status === 'resolved' && resolution === '') {
        throw invalid(index, 'resolving a conflict needs a resolution text');
      }
      state.conflicts.set(conflict.id, {
        ...conflict,
        ...(operation.componentIds === undefined
          ? {}
          : { componentIds: checkConflictComponents(state, index, operation.componentIds) }),
        ...(operation.description === undefined
          ? {}
          : { description: requireDescription(index, operation.description) }),
        status,
        resolution,
      });
      return;
    }
    case 'deleteConflict': {
      if (!state.conflicts.delete(operation.conflictId)) {
        throw invalid(index, `unknown conflict "${operation.conflictId}"`);
      }
      return;
    }
    case 'updateDraft': {
      if (operation.goal !== undefined) state.goal = checkText(index, operation.goal, 'goal');
      if (operation.changeSummary !== undefined) {
        state.changeSummary = checkText(index, operation.changeSummary, 'change summary');
      }
      if (operation.acceptance !== undefined) {
        state.acceptance = checkList(index, operation.acceptance, 'acceptance criteria');
      }
      if (operation.openQuestions !== undefined) {
        state.openQuestions = checkList(index, operation.openQuestions, 'open questions');
      }
      return;
    }
  }
};

/** Components in tree order: parents before children, siblings by order. */
const treeOrder = (state: MutableDraft): DraftComponent[] => {
  const result: DraftComponent[] = [];
  const visit = (parentId: string | null): void => {
    for (const component of siblings(state, parentId)) {
      result.push({
        componentId: component.componentId,
        parentId: component.parentId,
        order: component.order,
        name: component.name,
        kind: component.kind,
        hidden: component.hidden,
        spec: component.spec,
        regions: component.regions,
      });
      visit(component.componentId);
    }
  };
  visit(null);
  return result;
};

/**
 * Applies a batch of operations atomically: either all succeed or a VALIDATION error
 * names the failing operation. Returns a new draft; the input is not modified. Revision
 * and timestamp are set by the caller that persists the result.
 */
export const applyDraftOperations = (
  draft: Draft,
  operations: readonly DraftOperation[],
  context: DraftContext,
): Draft => {
  if (operations.length > DRAFT_LIMITS.maxOperationsPerRequest) {
    throw new OpsisError('VALIDATION', 'Too many operations in one request');
  }
  const state = toMutable(draft);
  operations.forEach((operation, index) => {
    applyOne(state, operation, index, context);
  });
  return {
    ...draft,
    goal: state.goal,
    changeSummary: state.changeSummary,
    acceptance: state.acceptance,
    openQuestions: state.openQuestions,
    components: treeOrder(state),
    relations: [...state.relations.values()].sort((a, b) => a.id.localeCompare(b.id)),
    conflicts: [...state.conflicts.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
};
