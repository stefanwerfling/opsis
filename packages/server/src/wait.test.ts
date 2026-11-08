import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LOCAL_HUMAN,
  OpsisError,
  cancelSession,
  changeDraft,
  createAgent,
  createProject,
  getSession,
  newId,
  releaseSpecification,
  submitScreenshot,
  waitForSpecification,
  type Actor,
  type WaitProgress,
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
    await makeImage(),
  );
  return { sessionId: result.session.id, screenshotId: result.screenshot.id };
};

const release = (sessionId: string, screenshotId: string) => {
  const componentId = newId('component');
  changeDraft(env.ctx, LOCAL_HUMAN, sessionId, {
    baseRevision: 0,
    operations: [
      {
        op: 'addComponent',
        componentId,
        parentId: null,
        name: 'Box',
        kind: 'container',
        region: { screenshotId, x: 1, y: 1, width: 50, height: 50 },
      },
    ],
  });
  releaseSpecification(env.ctx, LOCAL_HUMAN, sessionId, {
    rowVersion: getSession(env.ctx, LOCAL_HUMAN, sessionId).session.rowVersion,
    acknowledgedWarnings: [`missing_description:${componentId}`, `missing_acceptance:${componentId}`],
  });
};

const later = (ms: number, work: () => void): void => {
  setTimeout(work, ms);
};

describe('waitForSpecification', () => {
  it('answers immediately when the specification is already released', async () => {
    const { sessionId, screenshotId } = await submitted();
    release(sessionId, screenshotId);
    const result = await waitForSpecification(env.ctx, agent, sessionId, { timeoutMs: 10_000 });
    expect(result).toEqual({ done: true, status: 'ready', waitedSeconds: 0, aborted: false });
    expect(env.bus.listenerCount).toBe(1); // only the test's own event recorder
  });

  it('ends as soon as the human releases during the wait', async () => {
    const { sessionId, screenshotId } = await submitted();
    later(50, () => {
      release(sessionId, screenshotId);
    });
    const result = await waitForSpecification(env.ctx, agent, sessionId, { timeoutMs: 10_000 });
    expect(result).toMatchObject({ done: true, status: 'ready', aborted: false });
    expect(result.waitedSeconds).toBeLessThan(5);
    expect(env.bus.listenerCount).toBe(1);
  });

  it('times out without an error and reports the current status', async () => {
    const { sessionId } = await submitted();
    const result = await waitForSpecification(env.ctx, agent, sessionId, { timeoutMs: 80 });
    expect(result).toMatchObject({ done: false, status: 'awaiting_review', aborted: false });
    expect(env.bus.listenerCount).toBe(1);
  });

  it('ends with the session when it is cancelled', async () => {
    const { sessionId } = await submitted();
    later(30, () => {
      cancelSession(env.ctx, LOCAL_HUMAN, sessionId, 'not needed');
    });
    const result = await waitForSpecification(env.ctx, agent, sessionId, { timeoutMs: 10_000 });
    expect(result).toMatchObject({ done: true, status: 'cancelled' });
  });

  it('stops and cleans up when the caller aborts', async () => {
    const { sessionId } = await submitted();
    const controller = new AbortController();
    later(30, () => {
      controller.abort();
    });
    const result = await waitForSpecification(env.ctx, agent, sessionId, {
      timeoutMs: 10_000,
      signal: controller.signal,
    });
    expect(result).toMatchObject({ done: false, status: 'awaiting_review', aborted: true });
    expect(env.bus.listenerCount).toBe(1);
  });

  it('finds a change without an event through the database poll', async () => {
    const { sessionId } = await submitted();
    later(30, () => {
      // Simulates a lost event: the status changes, nobody publishes.
      env.db.execute("UPDATE sessions SET status = 'failed' WHERE id = :id", { id: sessionId });
    });
    const result = await waitForSpecification(env.ctx, agent, sessionId, { timeoutMs: 10_000, pollMs: 20 });
    expect(result).toMatchObject({ done: true, status: 'failed' });
  });

  it('reports progress with the number of specified components', async () => {
    const { sessionId, screenshotId } = await submitted();
    changeDraft(env.ctx, LOCAL_HUMAN, sessionId, {
      baseRevision: 0,
      operations: [
        {
          op: 'addComponent',
          componentId: newId('component'),
          parentId: null,
          name: 'Box',
          kind: 'container',
          region: { screenshotId, x: 1, y: 1, width: 50, height: 50 },
        },
      ],
    });
    const progress: WaitProgress[] = [];
    await waitForSpecification(env.ctx, agent, sessionId, {
      timeoutMs: 130,
      progressMs: 40,
      onProgress: (entry) => {
        progress.push(entry);
        throw new Error('client gone'); // must not end the wait
      },
    });
    expect(progress.length).toBeGreaterThanOrEqual(2);
    expect(progress[0]).toMatchObject({ status: 'in_progress', componentCount: 1 });
  });

  it('checks access and the timeout bounds', async () => {
    const { sessionId } = await submitted();
    const other: Actor = { type: 'agent', id: newId('agent'), name: 'other' };
    const code = (work: () => unknown) => {
      try {
        work();
      } catch (error) {
        return error instanceof OpsisError ? error.code : 'other';
      }
      return 'none';
    };
    expect(code(() => waitForSpecification(env.ctx, other, sessionId, { timeoutMs: 10 }))).toBe('NOT_FOUND');
    expect(code(() => waitForSpecification(env.ctx, agent, sessionId, { timeoutMs: 601_000 }))).toBe(
      'VALIDATION',
    );
    expect(env.bus.listenerCount).toBe(1);
  });
});
