import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LOCAL_HUMAN,
  OpsisError,
  cancelSession,
  changeUiPath,
  confirmAssignment,
  createProject,
  createUiView,
  getProject,
  getScreenshot,
  getSession,
  getUiView,
  listProjects,
  listScreenshots,
  listUiViews,
  startReview,
  submitScreenshot,
  updateProject,
  type Actor,
  type SubmitScreenshotInput,
} from '@opsis/core';
import { createTestEnv, insertAgent, makeImage, type TestEnv } from './testing/support.js';

const agentA: Actor = { type: 'agent', id: 'agt_a', name: 'agent-a' };
const agentB: Actor = { type: 'agent', id: 'agt_b', name: 'agent-b' };

const codeOf = async (work: () => unknown): Promise<string> => {
  try {
    await work();
    return 'NO_ERROR';
  } catch (error) {
    return error instanceof OpsisError ? error.code : `UNEXPECTED: ${String(error)}`;
  }
};

let env: TestEnv;
beforeEach(() => {
  env = createTestEnv();
  insertAgent(env.db, agentA.id);
  insertAgent(env.db, agentB.id);
});
afterEach(() => {
  env.cleanup();
});

const submit = async (actor: Actor, input: Omit<SubmitScreenshotInput, 'source'>, seed = 0) =>
  submitScreenshot(env.ctx, actor, { source: 'mcp', ...input }, await makeImage('png', 1440, 900, seed));

describe('projects', () => {
  it('manages several independent projects with unique slugs', () => {
    const a = createProject(env.ctx, LOCAL_HUMAN, { name: 'My Application' });
    const b = createProject(env.ctx, LOCAL_HUMAN, { name: 'My Application' });
    expect(a.slug).toBe('my-application');
    expect(b.slug).toBe('my-application-2');
    expect(
      listProjects(env.ctx, LOCAL_HUMAN)
        .map((p) => p.id)
        .sort(),
    ).toEqual([a.id, b.id].sort());
  });

  it('rejects an explicitly requested slug that is taken', async () => {
    createProject(env.ctx, LOCAL_HUMAN, { name: 'A', slug: 'shop' });
    expect(await codeOf(() => createProject(env.ctx, LOCAL_HUMAN, { name: 'B', slug: 'shop' }))).toBe(
      'CONFLICT',
    );
  });

  it('updates metadata and records an audit entry', () => {
    const project = createProject(env.ctx, LOCAL_HUMAN, { name: 'A' });
    env.clock.advance(1000);
    const updated = updateProject(env.ctx, LOCAL_HUMAN, project.id, {
      promptLanguage: 'de',
      metadata: { repo: 'x' },
    });
    expect(updated).toMatchObject({
      promptLanguage: 'de',
      metadata: { repo: 'x' },
      createdAt: project.createdAt,
    });
    expect(updated.updatedAt > project.updatedAt).toBe(true);
    const actions = env.db.all('SELECT action FROM audit_log WHERE entity_id = :id ORDER BY at', {
      id: project.id,
    });
    expect(actions.map((r) => r['action'])).toEqual(['create', 'update']);
  });

  it('validates input', async () => {
    expect(await codeOf(() => createProject(env.ctx, LOCAL_HUMAN, { name: '' }))).toBe('VALIDATION');
  });
});

describe('access control between projects', () => {
  it('grants an agent access to the projects it creates – and only those', async () => {
    const own = createProject(env.ctx, agentA, { name: 'A' });
    const foreign = createProject(env.ctx, agentB, { name: 'B' });
    const humanOnly = createProject(env.ctx, LOCAL_HUMAN, { name: 'H' });

    expect(listProjects(env.ctx, agentA).map((p) => p.id)).toEqual([own.id]);
    expect(listProjects(env.ctx, LOCAL_HUMAN)).toHaveLength(3);
    expect(await codeOf(() => getProject(env.ctx, agentA, foreign.id))).toBe('NOT_FOUND');
    expect(await codeOf(() => getProject(env.ctx, agentA, humanOnly.id))).toBe('NOT_FOUND');
    expect(await codeOf(() => updateProject(env.ctx, agentA, foreign.id, { name: 'x' }))).toBe('NOT_FOUND');
    expect(await codeOf(() => listUiViews(env.ctx, agentA, foreign.id))).toBe('NOT_FOUND');
  });

  it('prevents an agent from reading or modifying sessions and screenshots of a foreign project', async () => {
    const foreign = createProject(env.ctx, agentB, { name: 'B' });
    const { session, screenshot } = await submit(agentB, { projectId: foreign.id, uiPath: '/login' });
    createProject(env.ctx, agentA, { name: 'A' });

    expect(await codeOf(() => getSession(env.ctx, agentA, session.id))).toBe('NOT_FOUND');
    expect(await codeOf(() => getScreenshot(env.ctx, agentA, screenshot.id))).toBe('NOT_FOUND');
    expect(await codeOf(() => listScreenshots(env.ctx, agentA, { projectId: foreign.id }))).toBe('NOT_FOUND');
    expect(await codeOf(() => cancelSession(env.ctx, agentA, session.id, 'x'))).toBe('NOT_FOUND');
    expect(await codeOf(() => submit(agentA, { projectId: foreign.id, uiPath: '/x' }))).toBe('NOT_FOUND');
    expect(await codeOf(() => submit(agentA, { projectId: foreign.id, sessionId: session.id }))).toBe(
      'NOT_FOUND',
    );
  });
});

describe('UI views: UI-ID vs. UI-path', () => {
  it('derives a UI-ID from the path and keeps it when the path changes', () => {
    const project = createProject(env.ctx, LOCAL_HUMAN, { name: 'P' });
    const view = createUiView(env.ctx, LOCAL_HUMAN, project.id, { path: '/dashboard' });
    expect(view).toMatchObject({ uiId: 'ui-dashboard', path: '/dashboard', name: 'Dashboard' });

    const moved = changeUiPath(env.ctx, LOCAL_HUMAN, project.id, 'ui-dashboard', {
      newPath: '/home',
      reason: 'rename',
    });
    expect(moved).toMatchObject({ id: view.id, uiId: 'ui-dashboard', path: '/home' });
    const details = getUiView(env.ctx, LOCAL_HUMAN, project.id, 'ui-dashboard');
    expect(details.pathHistory.map((c) => [c.oldPath, c.newPath])).toEqual([
      [null, '/dashboard'],
      ['/dashboard', '/home'],
    ]);
  });

  it('rejects duplicate UI-IDs and paths within a project, but allows them across projects', async () => {
    const p1 = createProject(env.ctx, LOCAL_HUMAN, { name: 'P1' });
    const p2 = createProject(env.ctx, LOCAL_HUMAN, { name: 'P2' });
    createUiView(env.ctx, LOCAL_HUMAN, p1.id, { uiId: 'ui-dashboard-main', path: '/dashboard' });
    expect(
      await codeOf(() =>
        createUiView(env.ctx, LOCAL_HUMAN, p1.id, { uiId: 'ui-dashboard-main', path: '/x' }),
      ),
    ).toBe('CONFLICT');
    expect(await codeOf(() => createUiView(env.ctx, LOCAL_HUMAN, p1.id, { path: '/dashboard' }))).toBe(
      'CONFLICT',
    );
    expect(
      createUiView(env.ctx, LOCAL_HUMAN, p2.id, { uiId: 'ui-dashboard-main', path: '/dashboard' }).projectId,
    ).toBe(p2.id);
  });

  it('makes derived UI-IDs unique', () => {
    const project = createProject(env.ctx, LOCAL_HUMAN, { name: 'P' });
    createUiView(env.ctx, LOCAL_HUMAN, project.id, { uiId: 'ui-admin-users', path: '/legacy' });
    expect(createUiView(env.ctx, LOCAL_HUMAN, project.id, { path: '/admin/users' }).uiId).toBe(
      'ui-admin-users-2',
    );
  });

  it('refuses a path change onto a path owned by another UI', async () => {
    const project = createProject(env.ctx, LOCAL_HUMAN, { name: 'P' });
    createUiView(env.ctx, LOCAL_HUMAN, project.id, { path: '/a' });
    createUiView(env.ctx, LOCAL_HUMAN, project.id, { path: '/b' });
    expect(
      await codeOf(() => changeUiPath(env.ctx, LOCAL_HUMAN, project.id, 'ui-a', { newPath: '/b' })),
    ).toBe('CONFLICT');
  });
});

describe('submitScreenshot', () => {
  let projectId: string;
  beforeEach(() => {
    projectId = createProject(env.ctx, agentA, { name: 'MyApplication' }).id;
  });

  it('creates UI view, screenshot and session and walks the upload states', async () => {
    const result = await submit(agentA, {
      projectId,
      uiPath: '/dashboard',
      uiIdHint: 'ui-dashboard-main',
      agentSessionRef: 'claude-conv-42',
      metadata: {
        viewportWidth: 1440,
        viewportHeight: 900,
        deviceCategory: 'desktop',
        description: 'first draft',
      },
    });
    expect(result.uiViewCreated).toBe(true);
    expect(result.uiView).toMatchObject({ uiId: 'ui-dashboard-main', path: '/dashboard' });
    expect(result.session).toMatchObject({
      status: 'awaiting_review',
      assignment: 'confirmed',
      intent: 'create',
      agentId: agentA.id,
      agentSessionRef: 'claude-conv-42',
    });
    expect(result.screenshot).toMatchObject({
      width: 1440,
      height: 900,
      mimeType: 'image/png',
      viewportWidth: 1440,
      sequenceNo: 1,
      source: 'mcp',
      submittedBy: 'agent:agt_a',
      sessionId: result.session.id,
    });
    const details = getSession(env.ctx, agentA, result.session.id);
    expect(details.statusHistory.map((e) => e.toStatus)).toEqual(['created', 'uploading', 'awaiting_review']);
    expect(details.screenshots.map((s) => s.id)).toEqual([result.screenshot.id]);
  });

  it('assigns to an existing UI by UI-ID and numbers screenshots per UI', async () => {
    const first = await submit(agentA, { projectId, uiPath: '/dashboard' }, 1);
    const second = await submit(agentA, { projectId, uiId: first.uiView.uiId }, 2);
    expect(second.uiViewCreated).toBe(false);
    expect(second.session.assignment).toBe('confirmed');
    expect(second.session.id).not.toBe(first.session.id);
    expect(second.screenshot.sequenceNo).toBe(2);
    expect(listScreenshots(env.ctx, agentA, { projectId, uiViewId: first.uiView.id })).toHaveLength(2);
  });

  it('asks for confirmation when the path of a known UI-ID differs, and keeps the UI-ID on acceptance', async () => {
    const first = await submit(agentA, { projectId, uiPath: '/dashboard' });
    const moved = await submit(agentA, { projectId, uiId: first.uiView.uiId, uiPath: '/home' });
    expect(moved.session).toMatchObject({ assignment: 'needs_confirmation', proposedPath: '/home' });
    expect(moved.session.assignmentNote).toContain('differs');

    expect(
      await codeOf(() => confirmAssignment(env.ctx, agentA, moved.session.id, { acceptProposedPath: true })),
    ).toBe('FORBIDDEN_ACTOR');
    const confirmed = confirmAssignment(env.ctx, LOCAL_HUMAN, moved.session.id, { acceptProposedPath: true });
    expect(confirmed).toMatchObject({ assignment: 'confirmed', proposedPath: null });
    expect(getUiView(env.ctx, LOCAL_HUMAN, projectId, first.uiView.uiId).view).toMatchObject({
      id: first.uiView.id,
      path: '/home',
    });
  });

  it('never merges silently: a known path without UI-ID needs confirmation', async () => {
    const first = await submit(agentA, { projectId, uiPath: '/login' });
    const again = await submit(agentA, { projectId, uiPath: '/login' }, 5);
    expect(again.uiView.id).toBe(first.uiView.id);
    expect(again.uiViewCreated).toBe(false);
    expect(again.session.assignment).toBe('needs_confirmation');
  });

  it('needs confirmation when an unknown UI-ID collides with an existing path', async () => {
    await submit(agentA, { projectId, uiPath: '/login' });
    const result = await submit(agentA, { projectId, uiId: 'ui-signin', uiPath: '/login' });
    expect(result.uiViewCreated).toBe(false);
    expect(result.session.assignment).toBe('needs_confirmation');
    expect(result.session.assignmentNote).toContain('ui-signin');
    expect(listUiViews(env.ctx, agentA, projectId)).toHaveLength(1);
  });

  it('attaches variants to an open session without creating a new one', async () => {
    const desktop = await submit(agentA, { projectId, uiPath: '/dashboard' });
    const mobile = await submitScreenshot(
      env.ctx,
      agentA,
      {
        projectId,
        sessionId: desktop.session.id,
        source: 'mcp',
        metadata: { deviceCategory: 'mobile', viewportWidth: 390 },
      },
      await makeImage('webp', 390, 844),
    );
    expect(mobile.sessionCreated).toBe(false);
    expect(mobile.session.id).toBe(desktop.session.id);
    expect(mobile.screenshot).toMatchObject({
      deviceCategory: 'mobile',
      mimeType: 'image/webp',
      sequenceNo: 2,
    });
    expect(getSession(env.ctx, agentA, desktop.session.id).screenshots).toHaveLength(2);
  });

  it('refuses to attach to a closed session or a mismatching UI', async () => {
    const first = await submit(agentA, { projectId, uiPath: '/dashboard' });
    await submit(agentA, { projectId, uiPath: '/login' });
    expect(
      await codeOf(() => submit(agentA, { projectId, sessionId: first.session.id, uiId: 'ui-login' })),
    ).toBe('VALIDATION');
    cancelSession(env.ctx, agentA, first.session.id, 'no longer needed');
    expect(await codeOf(() => submit(agentA, { projectId, sessionId: first.session.id }))).toBe(
      'INVALID_TRANSITION',
    );
  });

  it('stores nothing in the database when the image is invalid', async () => {
    const before = env.db.get(
      'SELECT (SELECT COUNT(*) FROM sessions) + (SELECT COUNT(*) FROM screenshots) AS n',
    );
    const code = await codeOf(() =>
      submitScreenshot(
        env.ctx,
        agentA,
        { projectId, uiPath: '/x', source: 'mcp' },
        new TextEncoder().encode('no image'),
      ),
    );
    expect(code).toBe('UNSUPPORTED_MEDIA');
    expect(
      env.db.get('SELECT (SELECT COUNT(*) FROM sessions) + (SELECT COUNT(*) FROM screenshots) AS n'),
    ).toEqual(before);
    expect(listUiViews(env.ctx, agentA, projectId)).toHaveLength(0);
  });

  it('requires a path unless a UI-ID or session is given', async () => {
    expect(await codeOf(() => submit(agentA, { projectId }))).toBe('VALIDATION');
    expect(await codeOf(() => submit(agentA, { projectId, uiId: 'ui-unknown' }))).toBe('VALIDATION');
  });
});

describe('sessions', () => {
  let projectId: string;
  beforeEach(() => {
    projectId = createProject(env.ctx, agentA, { name: 'P' }).id;
  });

  it('keeps parallel sessions on the same UI independent and reports them as concurrent', async () => {
    const a = await submit(agentA, { projectId, uiPath: '/dashboard' }, 1);
    const b = await submit(agentA, { projectId, uiId: a.uiView.uiId }, 2);
    startReview(env.ctx, LOCAL_HUMAN, a.session.id);
    expect(getSession(env.ctx, agentA, b.session.id).session.status).toBe('awaiting_review');
    expect(getSession(env.ctx, agentA, a.session.id).concurrentSessionIds).toEqual([b.session.id]);

    cancelSession(env.ctx, LOCAL_HUMAN, b.session.id, 'duplicate');
    expect(getSession(env.ctx, agentA, a.session.id).session.status).toBe('in_progress');
    expect(getSession(env.ctx, agentA, a.session.id).concurrentSessionIds).toEqual([]);
  });

  it('lets only a human start the review', async () => {
    const { session } = await submit(agentA, { projectId, uiPath: '/x' });
    expect(await codeOf(() => startReview(env.ctx, agentA, session.id))).toBe('FORBIDDEN_ACTOR');
    expect(startReview(env.ctx, LOCAL_HUMAN, session.id).status).toBe('in_progress');
    // idempotent
    expect(startReview(env.ctx, LOCAL_HUMAN, session.id).status).toBe('in_progress');
  });

  it('lets an agent cancel only its own session', async () => {
    createProject(env.ctx, agentB, { name: 'B' });
    env.ctx.repos.grants.grant(agentB.id, projectId, env.clock.now());
    const { session } = await submit(agentA, { projectId, uiPath: '/x' });
    expect(await codeOf(() => cancelSession(env.ctx, agentB, session.id, 'x'))).toBe('FORBIDDEN_ACTOR');
    expect(cancelSession(env.ctx, agentA, session.id, 'obsolete')).toMatchObject({
      status: 'cancelled',
      statusReason: 'obsolete',
    });
    expect(await codeOf(() => cancelSession(env.ctx, agentA, session.id, 'again'))).toBe(
      'INVALID_TRANSITION',
    );
  });

  it('detects concurrent modification through optimistic locking', async () => {
    const { session } = await submit(agentA, { projectId, uiPath: '/x' });
    const stale = env.ctx.repos.sessions.findById(session.id);
    startReview(env.ctx, LOCAL_HUMAN, session.id);
    if (!stale) throw new Error('missing');
    expect(
      await codeOf(() => {
        env.ctx.repos.sessions.update({ ...stale, title: 'x' }, stale.rowVersion);
      }),
    ).toBe('VERSION_CONFLICT');
  });
});

describe('domain events', () => {
  it('are published after commit, in order, and not at all on rollback', async () => {
    const project = createProject(env.ctx, agentA, { name: 'P' });
    env.events.length = 0;
    const { session } = await submit(agentA, { projectId: project.id, uiPath: '/dashboard' });
    expect(env.events.map((e) => (e.type === 'SessionStatusChanged' ? `${e.type}:${e.to}` : e.type))).toEqual(
      [
        'UiViewChanged',
        'SessionStatusChanged:uploading',
        'ScreenshotSubmitted',
        'SessionStatusChanged:awaiting_review',
      ],
    );

    env.events.length = 0;
    expect(await codeOf(() => createUiView(env.ctx, LOCAL_HUMAN, project.id, { path: '/dashboard' }))).toBe(
      'CONFLICT',
    );
    expect(await codeOf(() => startReview(env.ctx, agentA, session.id))).toBe('FORBIDDEN_ACTOR');
    expect(env.events).toEqual([]);
  });
});
