import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LOCAL_HUMAN,
  OpsisError,
  createAgent,
  createProject,
  getDraft,
  getSession,
  proposeComponents,
  releaseSpecification,
  startReview,
  submitScreenshot,
  type Actor,
} from '@opsis/core';
import { createTestEnv, makeImage, type TestEnv } from './testing/support.js';

let env: TestEnv;
let agent: Actor;
beforeEach(() => {
  env = createTestEnv();
  const { agent: created } = createAgent(env.ctx, LOCAL_HUMAN, { name: 'a' });
  agent = { type: 'agent', id: created.id, name: created.name };
});
afterEach(() => {
  env.cleanup();
});

const submitted = async () => {
  const projectId = createProject(env.ctx, agent, { name: 'Shop' }).id;
  const result = await submitScreenshot(
    env.ctx,
    agent,
    { projectId, source: 'mcp', uiPath: '/x', metadata: {} },
    await makeImage('png', 320, 200),
  );
  return { projectId, sessionId: result.session.id, screenshotId: result.screenshot.id };
};

const errorOf = (work: () => unknown): OpsisError => {
  try {
    work();
  } catch (error) {
    if (error instanceof OpsisError) return error;
    throw error;
  }
  throw new Error('expected an OpsisError');
};

describe('proposeComponents', () => {
  it('adds components with auto_detected values, clamps markings and keeps the status', async () => {
    const { sessionId, screenshotId } = await submitted();
    const result = proposeComponents(env.ctx, agent, sessionId, {
      components: [
        {
          ref: 'list',
          name: 'Product list',
          kind: 'container',
          region: { screenshotId, x: -20, y: 10, width: 500, height: 100 },
          spec: { general: { description: 'Grid of products' }, layout: { scrolling: 'vertical' } },
        },
        { ref: 'card', parentRef: 'list', name: 'Product card' },
      ],
    });
    expect(result.specValues).toBe(2);
    const draft = getDraft(env.ctx, LOCAL_HUMAN, sessionId);
    const list = draft.components.find((component) => component.name === 'Product list');
    const card = draft.components.find((component) => component.name === 'Product card');
    expect(list?.regions).toEqual([{ screenshotId, x: 0, y: 10, width: 320, height: 100 }]);
    expect(list?.spec.layout?.scrolling).toEqual({ value: 'vertical', origin: 'auto_detected' });
    expect(card).toMatchObject({ parentId: list?.componentId, kind: 'component' });
    expect(getSession(env.ctx, LOCAL_HUMAN, sessionId).session.status).toBe('awaiting_review');

    expect(env.events.filter((event) => event.type === 'DraftChanged')).toHaveLength(1);
    const audit = env.db.get("SELECT data FROM audit_log WHERE action = 'propose'");
    expect(JSON.parse(String(audit?.['data']))).toEqual({ revision: 1, components: 2, specValues: 2 });
  });

  it('adds to earlier proposals and may attach to existing components', async () => {
    const { sessionId } = await submitted();
    const first = proposeComponents(env.ctx, agent, sessionId, {
      components: [{ ref: 'page', name: 'Page' }],
    });
    const pageId = first.created[0]?.componentId ?? '';
    proposeComponents(env.ctx, agent, sessionId, {
      components: [{ ref: 'footer', parentId: pageId, name: 'Footer' }],
    });
    const draft = getDraft(env.ctx, LOCAL_HUMAN, sessionId);
    expect(draft.revision).toBe(2);
    expect(draft.components.map((component) => [component.name, component.parentId])).toEqual([
      ['Page', null],
      ['Footer', pageId],
    ]);
  });

  it('validates the proposal as a whole and changes nothing on error', async () => {
    const { sessionId } = await submitted();
    const other = await submitted();
    const attempts: unknown[] = [
      { components: [] },
      {
        components: [
          { ref: 'a', name: 'A' },
          { ref: 'a', name: 'B' },
        ],
      },
      {
        components: [
          { ref: 'b', parentRef: 'later', name: 'B' },
          { ref: 'later', name: 'L' },
        ],
      },
      { components: [{ ref: 'a', parentRef: 'x', parentId: 'cmp_x', name: 'A' }] },
      { components: [{ ref: 'a', parentId: 'cmp_unknown', name: 'A' }] },
      { components: [{ ref: 'a', name: 'A', spec: { general: { color: 'red' } } }] },
      {
        components: [
          {
            ref: 'a',
            name: 'A',
            region: { screenshotId: other.screenshotId, x: 0, y: 0, width: 5, height: 5 },
          },
        ],
      },
      { components: [{ ref: 'a', name: ' ' }] },
    ];
    for (const input of attempts) {
      expect([input, errorOf(() => proposeComponents(env.ctx, agent, sessionId, input)).code]).toEqual([
        input,
        'VALIDATION',
      ]);
    }
    expect(getDraft(env.ctx, LOCAL_HUMAN, sessionId).revision).toBe(0);
  });

  it('is for agents only, with project access, before the review', async () => {
    const { sessionId } = await submitted();
    const input = { components: [{ ref: 'a', name: 'A' }] };
    expect(errorOf(() => proposeComponents(env.ctx, LOCAL_HUMAN, sessionId, input)).code).toBe(
      'FORBIDDEN_ACTOR',
    );
    const { agent: stranger } = createAgent(env.ctx, LOCAL_HUMAN, { name: 'b' });
    expect(
      errorOf(() =>
        proposeComponents(env.ctx, { type: 'agent', id: stranger.id, name: 'b' }, sessionId, input),
      ).code,
    ).toBe('NOT_FOUND');
    env.db.execute("UPDATE sessions SET status = 'cancelled' WHERE id = :id", { id: sessionId });
    expect(errorOf(() => proposeComponents(env.ctx, agent, sessionId, input)).code).toBe(
      'INVALID_TRANSITION',
    );
  });

  it('leaves unconfirmed proposals as release warnings for the human', async () => {
    const { sessionId } = await submitted();
    const { created } = proposeComponents(env.ctx, agent, sessionId, {
      components: [{ ref: 'a', name: 'A', spec: { general: { description: 'Box' } } }],
    });
    const id = created[0]?.componentId ?? '';
    startReview(env.ctx, LOCAL_HUMAN, sessionId);
    const error = errorOf(() =>
      releaseSpecification(env.ctx, LOCAL_HUMAN, sessionId, {
        rowVersion: getSession(env.ctx, LOCAL_HUMAN, sessionId).session.rowVersion,
        acknowledgedWarnings: [],
      }),
    );
    expect(error.code).toBe('INCOMPLETE');
    const warnings = (error.details?.['unacknowledgedWarnings'] as { id: string }[]).map(
      (warning) => warning.id,
    );
    expect(warnings).toContain(`unconfirmed_auto_detected:${id}:general.description`);
  });
});
