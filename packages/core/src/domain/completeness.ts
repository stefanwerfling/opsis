/**
 * Completeness report of a draft (architecture 02 §4). A pure function, used by the
 * release use case (server, authority) and live in the editor (browser).
 *
 * - blocking issues prevent the release,
 * - warnings must be acknowledged explicitly by the human ("release with open points"),
 * - unknown fields are reported so nothing incomplete is presented as complete.
 *
 * The rule-based hints (region outside parent, disabled state on a visual area) are only
 * hints: whether something really is a contradiction is decided by the human, who can
 * record it as a conflict. Nothing here invents a requirement.
 */
import { findComponent, regionOn, type Draft, type DraftComponent, type SpecValue } from './draft.js';
import type { Rect } from './geometry.js';
import { SPEC_GROUP_NAMES, SPEC_GROUPS, type SpecGroup } from './vocabulary.js';

export const BLOCKING_CODES = [
  'no_components',
  'assignment_unconfirmed',
  'open_conflict',
  'dangling_relation',
  'unnamed_component',
] as const;

export const WARNING_CODES = [
  'missing_description',
  'missing_acceptance',
  'unconfirmed_auto_detected',
  'open_questions',
  'region_outside_parent',
  'disabled_on_visual_area',
] as const;

export type BlockingCode = (typeof BLOCKING_CODES)[number];
export type WarningCode = (typeof WARNING_CODES)[number];
export type IssueCode = BlockingCode | WarningCode;

export interface CompletenessIssue {
  /** Stable key: the same problem keeps its id across edits, so acknowledgements stay valid. */
  readonly id: string;
  readonly severity: 'blocking' | 'warning';
  readonly code: IssueCode;
  readonly componentId?: string;
  readonly relationId?: string;
  readonly conflictId?: string;
  readonly screenshotId?: string;
  /** `group.field` of the affected spec value. */
  readonly field?: string;
}

export interface UnknownFields {
  readonly componentId: string;
  /** `group.field` of every field that is not specified. */
  readonly fields: readonly string[];
}

export interface CompletenessReport {
  readonly blocking: readonly CompletenessIssue[];
  readonly warnings: readonly CompletenessIssue[];
  readonly unknownFields: readonly UnknownFields[];
  readonly counts: {
    readonly components: number;
    readonly specifiedFields: number;
    readonly totalFields: number;
  };
}

export interface CompletenessContext {
  readonly assignment: 'confirmed' | 'needs_confirmation';
}

export const ALL_SPEC_FIELDS: readonly string[] = SPEC_GROUP_NAMES.flatMap((group) =>
  SPEC_GROUPS[group].map((field) => `${group}.${field}`),
);

export const specValueAt = (
  component: DraftComponent,
  group: SpecGroup,
  field: string,
): SpecValue | undefined =>
  (component.spec[group] as Readonly<Record<string, SpecValue>> | undefined)?.[field];

const issueId = (code: IssueCode, ...parts: (string | undefined)[]): string =>
  [code, ...parts.filter((part): part is string => part !== undefined)].join(':');

const contains = (outer: Rect, inner: Rect): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

export const assessCompleteness = (draft: Draft, context: CompletenessContext): CompletenessReport => {
  const blocking: CompletenessIssue[] = [];
  const warnings: CompletenessIssue[] = [];
  const block = (issue: Omit<CompletenessIssue, 'severity' | 'id'>, id: string): void => {
    blocking.push({ id, severity: 'blocking', ...issue });
  };
  const warn = (issue: Omit<CompletenessIssue, 'severity' | 'id'>, id: string): void => {
    warnings.push({ id, severity: 'warning', ...issue });
  };

  // ── Blocking ──────────────────────────────────────────────────────────────
  if (draft.components.length === 0) block({ code: 'no_components' }, issueId('no_components'));
  if (context.assignment !== 'confirmed') {
    block({ code: 'assignment_unconfirmed' }, issueId('assignment_unconfirmed'));
  }
  for (const conflict of draft.conflicts) {
    if (conflict.status === 'open') {
      block({ code: 'open_conflict', conflictId: conflict.id }, issueId('open_conflict', conflict.id));
    }
  }
  for (const relation of draft.relations) {
    if (!findComponent(draft, relation.fromComponentId) || !findComponent(draft, relation.toComponentId)) {
      block(
        { code: 'dangling_relation', relationId: relation.id },
        issueId('dangling_relation', relation.id),
      );
    }
  }

  // ── Per component ─────────────────────────────────────────────────────────
  const unknownFields: UnknownFields[] = [];
  let specifiedFields = 0;
  for (const component of draft.components) {
    const componentId = component.componentId;
    if (component.name.trim() === '') {
      block({ code: 'unnamed_component', componentId }, issueId('unnamed_component', componentId));
    }
    if (specValueAt(component, 'general', 'description') === undefined) {
      warn({ code: 'missing_description', componentId }, issueId('missing_description', componentId));
    }
    if (component.spec.acceptance === undefined || Object.keys(component.spec.acceptance).length === 0) {
      warn({ code: 'missing_acceptance', componentId }, issueId('missing_acceptance', componentId));
    }

    const missing: string[] = [];
    for (const group of SPEC_GROUP_NAMES) {
      for (const field of SPEC_GROUPS[group]) {
        const key = `${group}.${field}`;
        const value = specValueAt(component, group, field);
        if (value === undefined) {
          missing.push(key);
          continue;
        }
        specifiedFields += 1;
        if (value.origin === 'auto_detected') {
          warn(
            { code: 'unconfirmed_auto_detected', componentId, field: key },
            issueId('unconfirmed_auto_detected', componentId, key),
          );
        }
      }
    }
    if (missing.length > 0) unknownFields.push({ componentId, fields: missing });

    // Hint: a child region that leaves its parent's region on the same screenshot.
    const parent = component.parentId === null ? undefined : findComponent(draft, component.parentId);
    if (parent) {
      for (const region of component.regions) {
        const parentRegion = regionOn(parent, region.screenshotId);
        if (parentRegion && !contains(parentRegion, region)) {
          warn(
            { code: 'region_outside_parent', componentId, screenshotId: region.screenshotId },
            issueId('region_outside_parent', componentId, region.screenshotId),
          );
        }
      }
    }
    // Hint: a disabled state described for something declared as a pure visual area.
    if (component.kind === 'visual_area' && specValueAt(component, 'interaction', 'disabled') !== undefined) {
      warn(
        { code: 'disabled_on_visual_area', componentId, field: 'interaction.disabled' },
        issueId('disabled_on_visual_area', componentId),
      );
    }
  }

  if (draft.openQuestions.length > 0) warn({ code: 'open_questions' }, issueId('open_questions'));

  return {
    blocking,
    warnings,
    unknownFields,
    counts: {
      components: draft.components.length,
      specifiedFields,
      totalFields: draft.components.length * ALL_SPEC_FIELDS.length,
    },
  };
};

/** Warnings the human has not acknowledged yet (release needs this to be empty). */
export const unacknowledgedWarnings = (
  report: CompletenessReport,
  acknowledged: readonly string[],
): CompletenessIssue[] => {
  const set = new Set(acknowledged);
  return report.warnings.filter((warning) => !set.has(warning.id));
};
