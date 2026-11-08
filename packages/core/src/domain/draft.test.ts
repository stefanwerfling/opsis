import { describe, expect, it } from 'vitest';
import {
  applyDraftOperations,
  childrenOf,
  componentDepths,
  emptyDraft,
  findComponent,
  subtreeIds,
  type Draft,
  type DraftContext,
  type DraftOperation,
} from './draft.js';
import { OpsisError } from './errors.js';
import { newId } from './ids.js';

const SCREENSHOT = 'scr_01JZ0000000000000000000000';
const context: DraftContext = { screenshots: [{ id: SCREENSHOT, width: 1000, height: 800 }] };

const ids = Object.fromEntries(
  ['card', 'header', 'content', 'footer', 'chart', 'legend', 'sidebar'].map((name) => [
    name,
    newId('component'),
  ]),
) as Record<'card' | 'header' | 'content' | 'footer' | 'chart' | 'legend' | 'sidebar', string>;

const add = (componentId: string, parentId: string | null, name: string, index?: number): DraftOperation => ({
  op: 'addComponent',
  componentId,
  parentId,
  name,
  kind: 'component',
  ...(index === undefined ? {} : { index }),
});

const apply = (draft: Draft, ...operations: DraftOperation[]) =>
  applyDraftOperations(draft, operations, context);

/** The card example from the requirements (section 7). */
const cardDraft = (): Draft =>
  apply(
    emptyDraft('ses_1', '2026-11-08T00:00:00.000Z'),
    add(ids.card, null, 'Card'),
    add(ids.header, ids.card, 'CardHeader'),
    add(ids.content, ids.card, 'CardContent'),
    add(ids.footer, ids.card, 'CardFooter'),
    add(ids.chart, ids.content, 'Chart'),
    add(ids.legend, ids.content, 'Legend'),
  );

const names = (draft: Draft) => draft.components.map((component) => component.name);

const expectInvalid = (fn: () => unknown, message: RegExp) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(OpsisError);
    expect((error as OpsisError).code).toBe('VALIDATION');
    expect((error as OpsisError).message).toMatch(message);
    return;
  }
  throw new Error('expected a VALIDATION error');
};

describe('component tree', () => {
  it('builds an arbitrarily deep tree in tree order with contiguous sibling order', () => {
    const draft = cardDraft();
    expect(names(draft)).toEqual(['Card', 'CardHeader', 'CardContent', 'Chart', 'Legend', 'CardFooter']);
    expect(childrenOf(draft, ids.card).map((c) => c.order)).toEqual([0, 1, 2]);
    expect(componentDepths(draft).get(ids.legend)).toBe(2);
  });

  it('inserts at an index among siblings', () => {
    const extra = newId('component');
    const draft = apply(cardDraft(), add(extra, ids.card, 'Badge', 1));
    expect(childrenOf(draft, ids.card).map((c) => c.name)).toEqual([
      'CardHeader',
      'Badge',
      'CardContent',
      'CardFooter',
    ]);
  });

  it('moves a subtree to another parent and renumbers both sibling lists', () => {
    const draft = apply(cardDraft(), {
      op: 'moveComponent',
      componentId: ids.content,
      parentId: null,
      index: 0,
    });
    expect(childrenOf(draft, null).map((c) => c.name)).toEqual(['CardContent', 'Card']);
    expect(childrenOf(draft, ids.card).map((c) => [c.name, c.order])).toEqual([
      ['CardHeader', 0],
      ['CardFooter', 1],
    ]);
    // children travel with their parent
    expect(subtreeIds(draft, ids.content)).toEqual([ids.content, ids.chart, ids.legend]);
  });

  it('reorders within the same parent', () => {
    const draft = apply(cardDraft(), {
      op: 'moveComponent',
      componentId: ids.footer,
      parentId: ids.card,
      index: 0,
    });
    expect(childrenOf(draft, ids.card).map((c) => c.name)).toEqual([
      'CardFooter',
      'CardHeader',
      'CardContent',
    ]);
  });

  it('rejects moves that would create a cycle', () => {
    const draft = cardDraft();
    expectInvalid(
      () => apply(draft, { op: 'moveComponent', componentId: ids.card, parentId: ids.chart, index: 0 }),
      /into itself or its descendants/,
    );
    expectInvalid(
      () => apply(draft, { op: 'moveComponent', componentId: ids.card, parentId: ids.card, index: 0 }),
      /into itself/,
    );
  });

  it('duplicates a subtree with new ids right after the original', () => {
    const draft = cardDraft();
    const idMap = Object.fromEntries(subtreeIds(draft, ids.content).map((id) => [id, newId('component')]));
    const result = apply(draft, { op: 'duplicateComponent', componentId: ids.content, idMap });
    expect(childrenOf(result, ids.card).map((c) => c.name)).toEqual([
      'CardHeader',
      'CardContent',
      'CardContent',
      'CardFooter',
    ]);
    const copy = findComponent(result, idMap[ids.content] ?? '');
    expect(copy?.parentId).toBe(ids.card);
    expect(childrenOf(result, copy?.componentId ?? '').map((c) => c.name)).toEqual(['Chart', 'Legend']);
    // the original is untouched
    expect(childrenOf(result, ids.content).map((c) => c.componentId)).toEqual([ids.chart, ids.legend]);
  });

  it('requires the idMap to cover exactly the subtree', () => {
    expectInvalid(
      () =>
        apply(cardDraft(), {
          op: 'duplicateComponent',
          componentId: ids.content,
          idMap: { [ids.content]: newId('component') },
        }),
      /idMap/,
    );
  });

  it('deletes a subtree together with relations that touch it', () => {
    const relationId = newId('relation');
    const draft = apply(
      cardDraft(),
      {
        op: 'addRelation',
        relationId,
        fromComponentId: ids.header,
        toComponentId: ids.chart,
        kind: 'controls',
        description: '',
      },
      { op: 'deleteComponent', componentId: ids.content },
    );
    expect(names(draft)).toEqual(['Card', 'CardHeader', 'CardFooter']);
    expect(draft.relations).toEqual([]);
    expect(childrenOf(draft, ids.card).map((c) => c.order)).toEqual([0, 1]);
  });

  it('rejects unknown parents, duplicate ids, foreign id formats and empty names', () => {
    const draft = cardDraft();
    expectInvalid(() => apply(draft, add(newId('component'), newId('component'), 'X')), /unknown component/);
    expectInvalid(() => apply(draft, add(ids.card, null, 'Again')), /already exists/);
    expectInvalid(
      () => apply(draft, add('prj_01JZ0000000000000000000000', null, 'X')),
      /invalid component id/,
    );
    expectInvalid(() => apply(draft, add(newId('component'), null, '   ')), /name must not be empty/);
  });

  it('is atomic: a failing operation leaves the input untouched and reports its index', () => {
    const draft = cardDraft();
    try {
      apply(
        draft,
        { op: 'updateComponent', componentId: ids.card, name: 'Renamed' },
        { op: 'deleteComponent', componentId: 'cmp_nope' },
      );
      throw new Error('expected failure');
    } catch (error) {
      expect((error as OpsisError).details).toEqual({ operationIndex: 1 });
    }
    expect(findComponent(draft, ids.card)?.name).toBe('Card');
  });

  it('renames, retypes and hides', () => {
    const draft = apply(cardDraft(), {
      op: 'updateComponent',
      componentId: ids.chart,
      name: '  RevenueChart ',
      kind: 'visual_area',
      hidden: true,
    });
    expect(findComponent(draft, ids.chart)).toMatchObject({
      name: 'RevenueChart',
      kind: 'visual_area',
      hidden: true,
    });
  });
});

describe('regions', () => {
  it('stores regions in image pixels, clamped to the screenshot', () => {
    const draft = apply(cardDraft(), {
      op: 'setRegion',
      componentId: ids.card,
      screenshotId: SCREENSHOT,
      rect: { x: -10.4, y: 700.6, width: 2000, height: 500 },
    });
    expect(findComponent(draft, ids.card)?.regions).toEqual([
      { screenshotId: SCREENSHOT, x: 0, y: 701, width: 1000, height: 99 },
    ]);
  });

  it('replaces the region per screenshot and removes it with null', () => {
    let draft = apply(cardDraft(), {
      op: 'setRegion',
      componentId: ids.card,
      screenshotId: SCREENSHOT,
      rect: { x: 1, y: 2, width: 3, height: 4 },
    });
    draft = apply(draft, {
      op: 'setRegion',
      componentId: ids.card,
      screenshotId: SCREENSHOT,
      rect: { x: 10, y: 20, width: 30, height: 40 },
    });
    expect(findComponent(draft, ids.card)?.regions).toHaveLength(1);
    draft = apply(draft, { op: 'setRegion', componentId: ids.card, screenshotId: SCREENSHOT, rect: null });
    expect(findComponent(draft, ids.card)?.regions).toEqual([]);
  });

  it('only accepts screenshots of the session and finite numbers', () => {
    expectInvalid(
      () =>
        apply(cardDraft(), {
          op: 'setRegion',
          componentId: ids.card,
          screenshotId: 'scr_01JZ9999999999999999999999',
          rect: { x: 0, y: 0, width: 1, height: 1 },
        }),
      /does not belong to this session/,
    );
    expectInvalid(
      () =>
        apply(cardDraft(), {
          op: 'setRegion',
          componentId: ids.card,
          screenshotId: SCREENSHOT,
          rect: { x: Number.NaN, y: 0, width: 1, height: 1 },
        }),
      /finite/,
    );
  });

  it('keeps regions when components are duplicated', () => {
    const draft = apply(cardDraft(), {
      op: 'setRegion',
      componentId: ids.chart,
      screenshotId: SCREENSHOT,
      rect: { x: 10, y: 10, width: 100, height: 50 },
    });
    const copyId = newId('component');
    const result = apply(draft, {
      op: 'duplicateComponent',
      componentId: ids.chart,
      idMap: { [ids.chart]: copyId },
    });
    expect(findComponent(result, copyId)?.regions).toEqual(findComponent(result, ids.chart)?.regions);
  });
});

describe('specification values', () => {
  it('sets values with origin and removes empty values (back to "not specified")', () => {
    let draft = apply(cardDraft(), {
      op: 'setSpecValue',
      componentId: ids.chart,
      group: 'interaction',
      field: 'hover',
      value: { value: 'Shows the exact value as tooltip', origin: 'user' },
    });
    expect(findComponent(draft, ids.chart)?.spec).toEqual({
      interaction: { hover: { value: 'Shows the exact value as tooltip', origin: 'user' } },
    });
    draft = apply(draft, {
      op: 'setSpecValue',
      componentId: ids.chart,
      group: 'interaction',
      field: 'hover',
      value: { value: '   ', origin: 'user' },
    });
    expect(findComponent(draft, ids.chart)?.spec).toEqual({});
  });

  it('only accepts the groups and fields from the requirements', () => {
    expectInvalid(
      () =>
        apply(cardDraft(), {
          op: 'setSpecValue',
          componentId: ids.chart,
          group: 'interaction',
          field: 'colors',
          value: { value: 'red', origin: 'user' },
        }),
      /unknown field "colors"/,
    );
  });

  it('does not share spec objects between the input and the result', () => {
    const draft = apply(cardDraft(), {
      op: 'setSpecValue',
      componentId: ids.chart,
      group: 'visual',
      field: 'colors',
      value: { value: 'blue', origin: 'screenshot_derived', note: 'from the screenshot' },
    });
    const next = apply(draft, {
      op: 'setSpecValue',
      componentId: ids.chart,
      group: 'visual',
      field: 'sizes',
      value: { value: '320 × 200', origin: 'user' },
    });
    expect(Object.keys(findComponent(draft, ids.chart)?.spec.visual ?? {})).toEqual(['colors']);
    expect(Object.keys(findComponent(next, ids.chart)?.spec.visual ?? {})).toEqual(['colors', 'sizes']);
  });
});

describe('relations and draft fields', () => {
  it('adds, updates and deletes relations between different components', () => {
    const relationId = newId('relation');
    let draft = apply(cardDraft(), {
      op: 'addRelation',
      relationId,
      fromComponentId: ids.legend,
      toComponentId: ids.chart,
      kind: 'controls',
      description: 'Toggles series',
    });
    draft = apply(draft, { op: 'updateRelation', relationId, kind: 'data_flow' });
    expect(draft.relations).toEqual([
      {
        id: relationId,
        fromComponentId: ids.legend,
        toComponentId: ids.chart,
        kind: 'data_flow',
        description: 'Toggles series',
      },
    ]);
    expectInvalid(
      () =>
        apply(draft, {
          op: 'addRelation',
          relationId: newId('relation'),
          fromComponentId: ids.chart,
          toComponentId: ids.chart,
          kind: 'other',
          description: '',
        }),
      /two different components/,
    );
    expect(apply(draft, { op: 'deleteRelation', relationId }).relations).toEqual([]);
  });

  it('updates goal and lists, dropping blank list entries', () => {
    const draft = apply(emptyDraft('ses_1', 'now'), {
      op: 'updateDraft',
      goal: 'Dashboard for sales',
      acceptance: [' Loads in under 2 s ', '', '  '],
      openQuestions: ['Which currency?'],
    });
    expect(draft).toMatchObject({
      goal: 'Dashboard for sales',
      acceptance: ['Loads in under 2 s'],
      openQuestions: ['Which currency?'],
    });
  });
});
