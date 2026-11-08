/**
 * Comparison of two released specifications (architecture 05 §4). A pure function on two
 * snapshots; components are matched by their stable `componentId`.
 *
 * It only reports what differs – whether a difference is intended is up to the human.
 */
import type { Rect } from './geometry.js';
import type { Relation, SpecValue } from './draft.js';
import type { SnapshotComponent, SnapshotScreenshot, SpecSnapshot } from './specification/snapshot.js';
import { SPEC_GROUP_NAMES, SPEC_GROUPS, type ComponentKind, type DeviceCategory } from './vocabulary.js';

/** Region centre shifts and size changes up to this many pixels count as unchanged. */
export const GEOMETRY_TOLERANCE_PX = 2;

export type ComponentChangeStatus = 'added' | 'removed' | 'changed' | 'unchanged';

export interface Change<T> {
  readonly before: T;
  readonly after: T;
}

export interface FieldChange {
  /** `group.field` */
  readonly field: string;
  readonly before: SpecValue | null;
  readonly after: SpecValue | null;
}

export interface GeometryChange {
  readonly deviceCategory: DeviceCategory;
  /** Region in a, scaled to b's screenshot (width ratio), and the region in b. */
  readonly before: Rect;
  readonly after: Rect;
  readonly moved: boolean;
  readonly resized: boolean;
}

export interface ComponentDiff {
  readonly componentId: string;
  /** Name in b (in a for removed components). */
  readonly name: string;
  readonly status: ComponentChangeStatus;
  readonly rename?: Change<string>;
  readonly kind?: Change<ComponentKind>;
  readonly parent?: Change<string | null>;
  /** Position changed relative to the siblings that exist in both versions. */
  readonly reordered?: boolean;
  readonly geometry: readonly GeometryChange[];
  readonly fields: readonly FieldChange[];
}

export interface RelationDiff {
  readonly added: readonly Relation[];
  readonly removed: readonly Relation[];
  readonly changed: readonly Change<Relation>[];
}

export interface ListDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

export interface VersionDiff {
  /** Components of b in tree order, followed by those removed from a. */
  readonly components: readonly ComponentDiff[];
  readonly relations: RelationDiff;
  readonly goal?: Change<string>;
  readonly acceptance: ListDiff;
  readonly openQuestions: ListDiff;
  readonly counts: Readonly<Record<ComponentChangeStatus, number>>;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const specValue = (component: SnapshotComponent, group: string, field: string): SpecValue | null =>
  (component.spec as Readonly<Record<string, Readonly<Record<string, SpecValue>> | undefined>>)[group]?.[
    field
  ] ?? null;

const fieldChanges = (a: SnapshotComponent, b: SnapshotComponent): FieldChange[] =>
  SPEC_GROUP_NAMES.flatMap((group) =>
    SPEC_GROUPS[group].flatMap((field): FieldChange[] => {
      const before = specValue(a, group, field);
      const after = specValue(b, group, field);
      return same(before, after) ? [] : [{ field: `${group}.${field}`, before, after }];
    }),
  );

/** First region per device category, in screenshot order. */
const regionsByDevice = (
  component: SnapshotComponent,
  snapshot: SpecSnapshot,
): Map<DeviceCategory, { rect: Rect; screenshot: SnapshotScreenshot }> => {
  const result = new Map<DeviceCategory, { rect: Rect; screenshot: SnapshotScreenshot }>();
  for (const screenshot of snapshot.screenshots) {
    const region = component.regions.find((candidate) => candidate.screenshotId === screenshot.id);
    if (region && !result.has(screenshot.deviceCategory)) {
      const { x, y, width, height } = region;
      result.set(screenshot.deviceCategory, { rect: { x, y, width, height }, screenshot });
    }
  }
  return result;
};

const geometryChanges = (
  a: SnapshotComponent,
  snapshotA: SpecSnapshot,
  b: SnapshotComponent,
  snapshotB: SpecSnapshot,
): GeometryChange[] => {
  const regionsA = regionsByDevice(a, snapshotA);
  const changes: GeometryChange[] = [];
  for (const [deviceCategory, after] of regionsByDevice(b, snapshotB)) {
    const before = regionsA.get(deviceCategory);
    if (!before) continue;
    // Normalised to b's screenshot: pages keep their layout width, so scale by width.
    const scale = before.screenshot.width > 0 ? after.screenshot.width / before.screenshot.width : 1;
    const scaled = {
      x: Math.round(before.rect.x * scale),
      y: Math.round(before.rect.y * scale),
      width: Math.round(before.rect.width * scale),
      height: Math.round(before.rect.height * scale),
    };
    const dx = scaled.x + scaled.width / 2 - (after.rect.x + after.rect.width / 2);
    const dy = scaled.y + scaled.height / 2 - (after.rect.y + after.rect.height / 2);
    const moved = Math.hypot(dx, dy) > GEOMETRY_TOLERANCE_PX;
    const resized =
      Math.abs(scaled.width - after.rect.width) > GEOMETRY_TOLERANCE_PX ||
      Math.abs(scaled.height - after.rect.height) > GEOMETRY_TOLERANCE_PX;
    if (moved || resized) changes.push({ deviceCategory, before: scaled, after: after.rect, moved, resized });
  }
  return changes;
};

/** Index of each component among its siblings that exist in both versions. */
const commonSiblingIndex = (snapshot: SpecSnapshot, common: ReadonlySet<string>): Map<string, number> => {
  const byParent = new Map<string | null, SnapshotComponent[]>();
  for (const component of snapshot.components) {
    if (!common.has(component.componentId)) continue;
    const siblings = byParent.get(component.parentId) ?? [];
    siblings.push(component);
    byParent.set(component.parentId, siblings);
  }
  const index = new Map<string, number>();
  for (const siblings of byParent.values()) {
    siblings.sort((x, y) => x.order - y.order).forEach((component, i) => index.set(component.componentId, i));
  }
  return index;
};

const listDiff = (a: readonly string[], b: readonly string[]): ListDiff => ({
  added: b.filter((entry) => !a.includes(entry)),
  removed: a.filter((entry) => !b.includes(entry)),
});

export const compareVersions = (a: SpecSnapshot, b: SpecSnapshot): VersionDiff => {
  const inA = new Map(a.components.map((component) => [component.componentId, component]));
  const inB = new Map(b.components.map((component) => [component.componentId, component]));
  const common = new Set([...inB.keys()].filter((id) => inA.has(id)));
  const indexA = commonSiblingIndex(a, common);
  const indexB = commonSiblingIndex(b, common);

  const components: ComponentDiff[] = [];
  for (const after of b.components) {
    const before = inA.get(after.componentId);
    if (!before) {
      components.push({
        componentId: after.componentId,
        name: after.name,
        status: 'added',
        geometry: [],
        fields: [],
      });
      continue;
    }
    const parentChanged = before.parentId !== after.parentId;
    const reordered = !parentChanged && indexA.get(after.componentId) !== indexB.get(after.componentId);
    const geometry = geometryChanges(before, a, after, b);
    const fields = fieldChanges(before, after);
    const diff: ComponentDiff = {
      componentId: after.componentId,
      name: after.name,
      status: 'unchanged',
      ...(before.name === after.name ? {} : { rename: { before: before.name, after: after.name } }),
      ...(before.kind === after.kind ? {} : { kind: { before: before.kind, after: after.kind } }),
      ...(parentChanged ? { parent: { before: before.parentId, after: after.parentId } } : {}),
      ...(reordered ? { reordered } : {}),
      geometry,
      fields,
    };
    const changed =
      diff.rename !== undefined ||
      diff.kind !== undefined ||
      parentChanged ||
      reordered ||
      geometry.length > 0 ||
      fields.length > 0;
    components.push(changed ? { ...diff, status: 'changed' } : diff);
  }
  for (const before of a.components) {
    if (inB.has(before.componentId)) continue;
    components.push({
      componentId: before.componentId,
      name: before.name,
      status: 'removed',
      geometry: [],
      fields: [],
    });
  }

  const relationsA = new Map(a.relations.map((relation) => [relation.id, relation]));
  const relationsB = new Map(b.relations.map((relation) => [relation.id, relation]));
  const relations: RelationDiff = {
    added: b.relations.filter((relation) => !relationsA.has(relation.id)),
    removed: a.relations.filter((relation) => !relationsB.has(relation.id)),
    changed: b.relations.flatMap((after) => {
      const before = relationsA.get(after.id);
      return before && !same(before, after) ? [{ before, after }] : [];
    }),
  };

  const counts = { added: 0, removed: 0, changed: 0, unchanged: 0 };
  for (const component of components) counts[component.status] += 1;

  return {
    components,
    relations,
    ...(a.goal === b.goal ? {} : { goal: { before: a.goal, after: b.goal } }),
    acceptance: listDiff(a.acceptance, b.acceptance),
    openQuestions: listDiff(a.openQuestions, b.openQuestions),
    counts,
  };
};
