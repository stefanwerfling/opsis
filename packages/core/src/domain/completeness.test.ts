import { describe, expect, it } from 'vitest';
import { ALL_SPEC_FIELDS, assessCompleteness, unacknowledgedWarnings } from './completeness.js';
import {
  applyDraftOperations,
  emptyDraft,
  type Draft,
  type DraftContext,
  type DraftOperation,
} from './draft.js';
import { OpsisError } from './errors.js';
import { newId } from './ids.js';

const SCREENSHOT = 'scr_01JZ0000000000000000000000';
const context: DraftContext = { screenshots: [{ id: SCREENSHOT, width: 1000, height: 800 }] };
const confirmed = { assignment: 'confirmed' } as const;

const card = newId('component');
const button = newId('component');
const conflictId = newId('conflict');

const apply = (draft: Draft, ...operations: DraftOperation[]): Draft =>
  applyDraftOperations(draft, operations, context);

const base = (): Draft =>
  apply(
    emptyDraft('ses_1', '2026-11-08T00:00:00.000Z'),
    {
      op: 'addComponent',
      componentId: card,
      parentId: null,
      name: 'Card',
      kind: 'container',
      region: { screenshotId: SCREENSHOT, x: 10, y: 10, width: 400, height: 300 },
    },
    {
      op: 'addComponent',
      componentId: button,
      parentId: card,
      name: 'Button',
      kind: 'interactive',
      region: { screenshotId: SCREENSHOT, x: 20, y: 250, width: 100, height: 40 },
    },
  );

const spec = (componentId: string, group: string, field: string, value: string, origin = 'user') =>
  ({
    op: 'setSpecValue',
    componentId,
    group,
    field,
    value: { value, origin },
  }) as DraftOperation;

/** Description and one acceptance criterion for both components. */
const described = (): Draft =>
  apply(
    base(),
    spec(card, 'general', 'description', 'Shows a product'),
    spec(card, 'acceptance', 'expectedBehavior', 'Shows the product name'),
    spec(button, 'general', 'description', 'Adds to the cart'),
    spec(button, 'acceptance', 'expectedBehavior', 'Click adds one item'),
  );

const codes = (issues: readonly { code: string }[]) => issues.map((issue) => issue.code);

describe('assessCompleteness', () => {
  it('blocks an empty draft and an unconfirmed assignment', () => {
    const report = assessCompleteness(emptyDraft('ses_1', 'now'), { assignment: 'needs_confirmation' });
    expect(codes(report.blocking)).toEqual(['no_components', 'assignment_unconfirmed']);
    expect(report.counts).toEqual({ components: 0, specifiedFields: 0, totalFields: 0 });
  });

  it('warns about missing descriptions and acceptance criteria', () => {
    const report = assessCompleteness(base(), confirmed);
    expect(report.blocking).toEqual([]);
    expect(report.warnings.map((warning) => warning.id)).toEqual([
      `missing_description:${card}`,
      `missing_acceptance:${card}`,
      `missing_description:${button}`,
      `missing_acceptance:${button}`,
    ]);
  });

  it('is clean for a described draft and reports every unspecified field', () => {
    const report = assessCompleteness(described(), confirmed);
    expect(report.blocking).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.counts).toEqual({
      components: 2,
      specifiedFields: 4,
      totalFields: 2 * ALL_SPEC_FIELDS.length,
    });
    const cardUnknown = report.unknownFields.find((entry) => entry.componentId === card);
    expect(cardUnknown?.fields).toHaveLength(ALL_SPEC_FIELDS.length - 2);
    expect(cardUnknown?.fields).not.toContain('general.description');
    expect(cardUnknown?.fields).toContain('visual.colors');
  });

  it('treats auto-detected values as unconfirmed until the human changes the origin', () => {
    const detected = apply(described(), spec(card, 'visual', 'colors', '#fff', 'auto_detected'));
    expect(assessCompleteness(detected, confirmed).warnings.map((warning) => warning.id)).toEqual([
      `unconfirmed_auto_detected:${card}:visual.colors`,
    ]);
    const confirmedValue = apply(detected, spec(card, 'visual', 'colors', '#fff', 'user'));
    expect(assessCompleteness(confirmedValue, confirmed).warnings).toEqual([]);
  });

  it('warns about open questions', () => {
    const draft = apply(described(), { op: 'updateDraft', openQuestions: ['Dark mode?'] });
    expect(codes(assessCompleteness(draft, confirmed).warnings)).toEqual(['open_questions']);
  });

  it('hints at a child region outside its parent region', () => {
    const draft = apply(described(), {
      op: 'setRegion',
      componentId: button,
      screenshotId: SCREENSHOT,
      rect: { x: 300, y: 280, width: 200, height: 40 },
    });
    expect(assessCompleteness(draft, confirmed).warnings).toEqual([
      {
        id: `region_outside_parent:${button}:${SCREENSHOT}`,
        severity: 'warning',
        code: 'region_outside_parent',
        componentId: button,
        screenshotId: SCREENSHOT,
      },
    ]);
  });

  it('hints at a disabled state on a visual area', () => {
    const draft = apply(
      described(),
      { op: 'updateComponent', componentId: card, kind: 'visual_area' },
      spec(card, 'interaction', 'disabled', 'greyed out'),
    );
    expect(codes(assessCompleteness(draft, confirmed).warnings)).toEqual(['disabled_on_visual_area']);
  });

  it('blocks open conflicts, not resolved ones', () => {
    const open = apply(described(), {
      op: 'addConflict',
      conflictId,
      componentIds: [card, button],
      description: 'Card says fixed width, button says full width',
    });
    expect(assessCompleteness(open, confirmed).blocking).toEqual([
      { id: `open_conflict:${conflictId}`, severity: 'blocking', code: 'open_conflict', conflictId },
    ]);
    const resolved = apply(open, {
      op: 'updateConflict',
      conflictId,
      status: 'resolved',
      resolution: 'Fixed width wins',
    });
    expect(assessCompleteness(resolved, confirmed).blocking).toEqual([]);
  });

  it('blocks dangling relations and unnamed components in foreign data', () => {
    const draft: Draft = {
      ...described(),
      relations: [
        { id: 'rel_x', fromComponentId: card, toComponentId: 'cmp_gone', kind: 'other', description: '' },
      ],
      components: described().components.map((component) =>
        component.componentId === button ? { ...component, name: ' ' } : component,
      ),
    };
    expect(codes(assessCompleteness(draft, confirmed).blocking)).toEqual([
      'dangling_relation',
      'unnamed_component',
    ]);
  });

  it('keeps warning ids stable so acknowledgements survive unrelated edits', () => {
    const report = assessCompleteness(base(), confirmed);
    const acknowledged = [`missing_description:${card}`, `missing_acceptance:${card}`];
    expect(unacknowledgedWarnings(report, acknowledged).map((warning) => warning.componentId)).toEqual([
      button,
      button,
    ]);
    const edited = apply(base(), { op: 'updateComponent', componentId: card, name: 'Product card' });
    expect(unacknowledgedWarnings(assessCompleteness(edited, confirmed), acknowledged)).toHaveLength(2);
  });
});

describe('conflict operations', () => {
  const withConflict = (): Draft =>
    apply(described(), { op: 'addConflict', conflictId, componentIds: [card, card], description: ' x ' });

  it('adds open conflicts with unique, existing components', () => {
    expect(withConflict().conflicts).toEqual([
      { id: conflictId, componentIds: [card], description: 'x', status: 'open', resolution: '' },
    ]);
  });

  it('rejects invalid ids, unknown components and empty descriptions', () => {
    const invalid: DraftOperation[] = [
      { op: 'addConflict', conflictId: 'cfl_bad', componentIds: [], description: 'x' },
      { op: 'addConflict', conflictId: newId('conflict'), componentIds: ['cmp_x'], description: 'x' },
      { op: 'addConflict', conflictId: newId('conflict'), componentIds: [], description: '  ' },
    ];
    for (const operation of invalid) expect(() => apply(described(), operation)).toThrow(OpsisError);
  });

  it('needs a resolution text to resolve and can be reopened', () => {
    expect(() => apply(withConflict(), { op: 'updateConflict', conflictId, status: 'resolved' })).toThrow(
      /resolution/,
    );
    const resolved = apply(withConflict(), {
      op: 'updateConflict',
      conflictId,
      status: 'resolved',
      resolution: 'Card wins',
    });
    const reopened = apply(resolved, { op: 'updateConflict', conflictId, status: 'open' });
    expect(reopened.conflicts[0]).toMatchObject({ status: 'open', resolution: 'Card wins' });
  });

  it('keeps the conflict but drops references when a component is deleted', () => {
    const draft = apply(withConflict(), { op: 'deleteComponent', componentId: card });
    expect(draft.conflicts).toEqual([
      { id: conflictId, componentIds: [], description: 'x', status: 'open', resolution: '' },
    ]);
  });

  it('deletes conflicts', () => {
    expect(apply(withConflict(), { op: 'deleteConflict', conflictId }).conflicts).toEqual([]);
    expect(() => apply(described(), { op: 'deleteConflict', conflictId })).toThrow(OpsisError);
  });
});
