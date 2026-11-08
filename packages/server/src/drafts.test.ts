import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LOCAL_HUMAN,
  OpsisError,
  cancelSession,
  changeDraft,
  createProject,
  getDraft,
  getSession,
  newId,
  submitScreenshot,
  type Actor,
  type DraftOperation,
} from '@opsis/core';
import { createTestEnv, insertAgent, makeImage, type TestEnv } from './testing/support.js';

const agent: Actor = { type: 'agent', id: 'agt_a', name: 'agent-a' };

let env: TestEnv;
beforeEach(() => {
  env = createTestEnv();
  insertAgent(env.db, agent.id);
});
afterEach(() => {
  env.cleanup();
});

const errorOf = (work: () => unknown): OpsisError => {
  try {
    work();
  } catch (error) {
    if (error instanceof OpsisError) return error;
    throw error;
  }
  throw new Error('expected an OpsisError');
};

/** A session created by an agent, as in the real flow. */
const setup = async () => {
  const project = createProject(env.ctx, agent, { name: 'Shop' });
  const result = await submitScreenshot(
    env.ctx,
    agent,
    { projectId: project.id, source: 'mcp', uiPath: '/dashboard', metadata: {} },
    await makeImage('png', 1200, 900),
  );
  return { project, sessionId: result.session.id, screenshotId: result.screenshot.id };
};

const add = (componentId: string, parentId: string | null, name: string): DraftOperation => ({
  op: 'addComponent',
  componentId,
  parentId,
  name,
  kind: 'component',
});

describe('draft use cases', () => {
  it('starts with an empty draft at revision 0', async () => {
    const { sessionId } = await setup();
    expect(getDraft(env.ctx, LOCAL_HUMAN, sessionId)).toMatchObject({
      sessionId,
      revision: 0,
      components: [],
      relations: [],
    });
  });

  it('persists the full component model and reads it back identically', async () => {
    const { sessionId, screenshotId } = await setup();
    const card = newId('component');
    const header = newId('component');
    const chart = newId('component');
    const relationId = newId('relation');
    const conflictId = newId('conflict');
    const saved = changeDraft(env.ctx, LOCAL_HUMAN, sessionId, {
      baseRevision: 0,
      operations: [
        { ...add(card, null, 'Card'), region: { screenshotId, x: 10, y: 10, width: 500, height: 300 } },
        add(header, card, 'CardHeader'),
        add(chart, card, 'Chart'),
        { op: 'moveComponent', componentId: chart, parentId: card, index: 0 },
        {
          op: 'setRegion',
          componentId: chart,
          screenshotId,
          rect: { x: 20, y: 60, width: 200.4, height: 99.6 },
        },
        {
          op: 'setSpecValue',
          componentId: chart,
          group: 'interaction',
          field: 'hover',
          value: { value: 'Tooltip with value', origin: 'user', note: 'confirmed by PO' },
        },
        { op: 'updateComponent', componentId: header, hidden: true, kind: 'container' },
        { op: 'addRelation', relationId, fromComponentId: header, toComponentId: chart, kind: 'controls' },
        { op: 'addConflict', conflictId, componentIds: [card, chart], description: 'Width unclear' },
        {
          op: 'updateDraft',
          goal: 'Sales overview',
          acceptance: ['Loads fast'],
          openQuestions: ['Currency?'],
        },
      ],
    });
    expect(saved.revision).toBe(1);
    const loaded = getDraft(env.ctx, LOCAL_HUMAN, sessionId);
    expect(loaded).toEqual(saved);
    expect(loaded.components.map((component) => component.name)).toEqual(['Card', 'Chart', 'CardHeader']);
    expect(loaded.components[1]?.regions).toEqual([{ screenshotId, x: 20, y: 60, width: 200, height: 100 }]);
    expect(loaded.relations[0]).toMatchObject({ kind: 'controls', description: '' });
    expect(loaded.conflicts).toEqual([
      {
        id: conflictId,
        componentIds: [card, chart],
        description: 'Width unclear',
        status: 'open',
        resolution: '',
      },
    ]);
  });

  it('starts the review on the first edit and records it', async () => {
    const { sessionId } = await setup();
    changeDraft(env.ctx, LOCAL_HUMAN, sessionId, {
      baseRevision: 0,
      operations: [add(newId('component'), null, 'Page')],
    });
    const details = getSession(env.ctx, LOCAL_HUMAN, sessionId);
    expect(details.session.status).toBe('in_progress');
    expect(details.statusHistory.at(-1)).toMatchObject({ toStatus: 'in_progress', note: 'first edit' });
    expect(env.events.filter((event) => event.type === 'DraftChanged')).toEqual([
      { type: 'DraftChanged', projectId: details.session.projectId, sessionId, revision: 1 },
    ]);
  });

  it('rejects stale revisions (optimistic locking) without writing anything', async () => {
    const { sessionId } = await setup();
    changeDraft(env.ctx, LOCAL_HUMAN, sessionId, {
      baseRevision: 0,
      operations: [add(newId('component'), null, 'A')],
    });
    const error = errorOf(() =>
      changeDraft(env.ctx, LOCAL_HUMAN, sessionId, {
        baseRevision: 0,
        operations: [add(newId('component'), null, 'B')],
      }),
    );
    expect(error.code).toBe('VERSION_CONFLICT');
    expect(error.details).toEqual({ currentRevision: 1 });
    expect(getDraft(env.ctx, LOCAL_HUMAN, sessionId).components.map((c) => c.name)).toEqual(['A']);
  });

  it('rolls back the whole batch when one operation is invalid', async () => {
    const { sessionId } = await setup();
    const error = errorOf(() =>
      changeDraft(env.ctx, LOCAL_HUMAN, sessionId, {
        baseRevision: 0,
        operations: [
          add(newId('component'), null, 'A'),
          { op: 'deleteComponent', componentId: 'cmp_missing' },
        ],
      }),
    );
    expect(error.code).toBe('VALIDATION');
    expect(getDraft(env.ctx, LOCAL_HUMAN, sessionId).revision).toBe(0);
    // the status change of the failed request was rolled back as well
    expect(getSession(env.ctx, LOCAL_HUMAN, sessionId).session.status).toBe('awaiting_review');
  });

  it('only lets a human edit, and only open sessions', async () => {
    const { sessionId } = await setup();
    const operations = [add(newId('component'), null, 'A')];
    expect(errorOf(() => changeDraft(env.ctx, agent, sessionId, { baseRevision: 0, operations })).code).toBe(
      'FORBIDDEN_ACTOR',
    );
    cancelSession(env.ctx, LOCAL_HUMAN, sessionId, 'not needed');
    expect(
      errorOf(() => changeDraft(env.ctx, LOCAL_HUMAN, sessionId, { baseRevision: 0, operations })).code,
    ).toBe('CONFLICT');
  });

  it('only accepts regions on screenshots of the same session', async () => {
    const { sessionId } = await setup();
    const other = await setup();
    const error = errorOf(() =>
      changeDraft(env.ctx, LOCAL_HUMAN, sessionId, {
        baseRevision: 0,
        operations: [
          {
            ...add(newId('component'), null, 'A'),
            region: { screenshotId: other.screenshotId, x: 0, y: 0, width: 10, height: 10 },
          },
        ],
      }),
    );
    expect(error.code).toBe('VALIDATION');
  });

  it('validates the input shape', async () => {
    const { sessionId } = await setup();
    for (const input of [
      { baseRevision: 0, operations: [] },
      { baseRevision: -1, operations: [add(newId('component'), null, 'A')] },
      { baseRevision: 0, operations: [{ op: 'dropTable' }] },
      { baseRevision: 0, operations: [{ ...add(newId('component'), null, 'A'), extra: 1 }] },
      { baseRevision: 0, operations: [{ ...add(newId('component'), null, 'A'), kind: 'widget' }] },
    ]) {
      expect(errorOf(() => changeDraft(env.ctx, LOCAL_HUMAN, sessionId, input)).code).toBe('VALIDATION');
    }
  });

  it('hides drafts of foreign projects from agents', async () => {
    const human = createProject(env.ctx, LOCAL_HUMAN, { name: 'Private' });
    const result = await submitScreenshot(
      env.ctx,
      LOCAL_HUMAN,
      { projectId: human.id, source: 'upload', uiPath: '/x', metadata: {} },
      await makeImage('png', 100, 100),
    );
    expect(errorOf(() => getDraft(env.ctx, agent, result.session.id)).code).toBe('NOT_FOUND');
  });

  it('handles a large tree (1000 components) within one request', async () => {
    const { sessionId } = await setup();
    const operations: DraftOperation[] = [];
    let parent: string | null = null;
    for (let i = 0; i < 1000; i += 1) {
      const id = newId('component');
      operations.push(add(id, i % 10 === 0 ? null : parent, `C${String(i)}`));
      if (i % 10 === 0) parent = id;
    }
    const first = operations.slice(0, 500);
    const second = operations.slice(500);
    changeDraft(env.ctx, LOCAL_HUMAN, sessionId, { baseRevision: 0, operations: first });
    const started = performance.now();
    const saved = changeDraft(env.ctx, LOCAL_HUMAN, sessionId, { baseRevision: 1, operations: second });
    const elapsed = performance.now() - started;
    expect(saved.components).toHaveLength(1000);
    expect(getDraft(env.ctx, LOCAL_HUMAN, sessionId).components).toHaveLength(1000);
    expect(elapsed).toBeLessThan(5000);
  });
});
