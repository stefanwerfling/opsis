import { applyDraftOperations, emptyDraft, newId, type DraftOperation } from '@opsis/core/browser';
import { describe, expect, it } from 'vitest';
import { confirmOperations, unconfirmedCount } from './proposals.js';

const a = newId('component');
const b = newId('component');
const draft = applyDraftOperations(
  emptyDraft('ses_1', '2026-11-08T00:00:00.000Z'),
  [
    { op: 'addComponent', componentId: a, parentId: null, name: 'A', kind: 'component' },
    { op: 'addComponent', componentId: b, parentId: null, name: 'B', kind: 'component' },
    {
      op: 'setSpecValue',
      componentId: a,
      group: 'general',
      field: 'description',
      value: { value: 'Box', origin: 'auto_detected' },
    },
    {
      op: 'setSpecValue',
      componentId: a,
      group: 'general',
      field: 'purpose',
      value: { value: 'Mine', origin: 'user' },
    },
    {
      op: 'setSpecValue',
      componentId: b,
      group: 'interaction',
      field: 'click',
      value: { value: 'Opens', origin: 'auto_detected', note: 'guess' },
    },
  ] satisfies DraftOperation[],
  { screenshots: [] },
);

describe('agent proposals in the editor', () => {
  it('counts unconfirmed values per component', () => {
    expect(draft.components.map(unconfirmedCount)).toEqual([1, 1]);
  });

  it('confirms the proposals of selected or all components, keeping text and note', () => {
    expect(confirmOperations(draft, [b])).toEqual([
      {
        op: 'setSpecValue',
        componentId: b,
        group: 'interaction',
        field: 'click',
        value: { value: 'Opens', origin: 'user', note: 'guess' },
      },
    ]);
    const confirmed = applyDraftOperations(draft, confirmOperations(draft), { screenshots: [] });
    expect(confirmed.components.map(unconfirmedCount)).toEqual([0, 0]);
    expect(confirmed.components[0]?.spec.general?.purpose).toEqual({ value: 'Mine', origin: 'user' });
    expect(confirmOperations(confirmed)).toEqual([]);
  });
});
