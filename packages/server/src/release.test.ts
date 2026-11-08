import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GENERATOR_VERSION,
  LOCAL_HUMAN,
  OpsisError,
  changeDraft,
  compareUiVersions,
  componentHistory,
  confirmAssignment,
  createProject,
  getDraft,
  getImplementationPrompt,
  getSession,
  getSpecification,
  getUiVersion,
  listUiVersions,
  newId,
  releaseSpecification,
  reopenSession,
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

const count = (table: string): number =>
  Number(env.db.get(`SELECT COUNT(*) AS n FROM ${table}`)?.['n'] ?? -1);

const header = newId('component');
const logo = newId('component');

/** A session submitted by an agent, as in the real flow. */
const submit = async (projectId?: string, uiId?: string) => {
  const project =
    projectId ?? createProject(env.ctx, agent, { name: 'Shop', description: 'Garden tools' }).id;
  const result = await submitScreenshot(
    env.ctx,
    agent,
    {
      projectId: project,
      source: 'mcp',
      ...(uiId === undefined ? { uiPath: '/dashboard' } : { uiId }),
      metadata: { description: 'Logged in' },
    },
    await makeImage('png', 1200, 900, uiId === undefined ? 0 : 1),
  );
  return { projectId: project, sessionId: result.session.id, uiId: result.uiView.uiId };
};

const edit = (sessionId: string, ...operations: DraftOperation[]) =>
  changeDraft(env.ctx, LOCAL_HUMAN, sessionId, {
    baseRevision: getDraft(env.ctx, LOCAL_HUMAN, sessionId).revision,
    operations,
  });

const spec = (componentId: string, group: string, field: string, value: string): DraftOperation =>
  ({ op: 'setSpecValue', componentId, group, field, value: { value, origin: 'user' } }) as DraftOperation;

/** Two fully described components: no warnings. */
const describeAll = (sessionId: string) => {
  const exists = getDraft(env.ctx, LOCAL_HUMAN, sessionId).components.length > 0;
  edit(
    sessionId,
    ...(exists
      ? []
      : [
          {
            op: 'addComponent',
            componentId: header,
            parentId: null,
            name: 'Header',
            kind: 'container',
          } as const,
          {
            op: 'addComponent',
            componentId: logo,
            parentId: header,
            name: 'Logo',
            kind: 'visual_area',
          } as const,
        ]),
    spec(header, 'general', 'description', 'Top bar'),
    spec(header, 'acceptance', 'expectedLayout', 'Sticky'),
    spec(logo, 'general', 'description', 'Shop logo'),
    spec(logo, 'acceptance', 'expectedBehavior', 'Click opens /'),
    { op: 'updateDraft', goal: 'Build the dashboard' },
  );
};

const release = (sessionId: string, extra: Record<string, unknown> = {}) =>
  releaseSpecification(env.ctx, LOCAL_HUMAN, sessionId, {
    rowVersion: getSession(env.ctx, LOCAL_HUMAN, sessionId).session.rowVersion,
    ...extra,
  });

describe('releaseSpecification', () => {
  it('turns the draft into immutable history and marks the session ready', async () => {
    const { sessionId } = await submit();
    describeAll(sessionId);
    env.events.length = 0;

    const result = release(sessionId, { changeDescription: 'First version' });

    expect(result.session).toMatchObject({ status: 'ready', resultVersionId: result.uiVersion.id });
    expect(result.uiVersion).toMatchObject({
      versionNo: 1,
      predecessorVersionId: null,
      pathAtVersion: '/dashboard',
      changeDescription: 'First version',
      createdBy: 'human:local',
    });
    expect(result.specRevision).toMatchObject({ revisionNo: 1, previousSpecRevisionId: null });
    const details = getSession(env.ctx, LOCAL_HUMAN, sessionId);
    expect(details.uiView.headVersionId).toBe(result.uiVersion.id);
    expect(details.statusHistory.at(-1)).toMatchObject({ toStatus: 'ready', note: 'released as V1' });
    expect([
      count('component_revisions'),
      count('spec_revision_components'),
      count('prompt_versions'),
    ]).toEqual([2, 2, 1]);
    expect(env.events.map((event) => event.type)).toEqual([
      'SessionStatusChanged',
      'UiVersionCreated',
      'UiViewChanged',
    ]);
    const audit = env.db.get("SELECT * FROM audit_log WHERE action = 'release'");
    expect(audit?.['entity_id']).toBe(result.uiVersion.id);
  });

  it('stores a prompt that references UI version, spec revision and screenshot', async () => {
    const { sessionId } = await submit();
    describeAll(sessionId);
    const { uiVersion, specRevision, promptVersion } = release(sessionId);
    expect(promptVersion.generatorVersion).toBe(GENERATOR_VERSION);
    for (const text of [
      `V1 (\`${uiVersion.id}\`)`,
      specRevision.id,
      uiVersion.screenshotId,
      '`ui-dashboard`',
      '`/dashboard`',
      '> Build the dashboard',
      '> Garden tools',
    ]) {
      expect(promptVersion.markdown).toContain(text);
    }
    expect(promptVersion.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(specRevision.snapshotSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses blocking issues without writing anything', async () => {
    const { sessionId } = await submit();
    edit(sessionId, { op: 'updateDraft', goal: 'x' });
    const error = errorOf(() => release(sessionId));
    expect(error.code).toBe('INCOMPLETE');
    expect(error.details?.['blocking']).toMatchObject([{ code: 'no_components' }]);
    expect(getSession(env.ctx, LOCAL_HUMAN, sessionId).session.status).toBe('in_progress');
    expect([count('ui_versions'), count('spec_revisions'), count('component_revisions')]).toEqual([0, 0, 0]);
  });

  it('needs every warning acknowledged and records the acknowledgements', async () => {
    const { sessionId } = await submit();
    edit(
      sessionId,
      { op: 'addComponent', componentId: header, parentId: null, name: 'Header', kind: 'container' },
      { op: 'updateDraft', openQuestions: ['Dark mode?'] },
    );
    const error = errorOf(() => release(sessionId));
    expect(error.code).toBe('INCOMPLETE');
    const unacknowledged = error.details?.['unacknowledgedWarnings'] as { id: string }[];
    expect(unacknowledged.map((warning) => warning.id)).toEqual([
      `missing_description:${header}`,
      `missing_acceptance:${header}`,
      'open_questions',
    ]);

    const ids = unacknowledged.map((warning) => warning.id);
    const result = release(sessionId, { acknowledgedWarnings: [...ids, 'not_a_warning'] });
    expect(result.specRevision.acknowledgedIssues).toEqual([...ids].sort());
    expect(result.promptVersion.markdown).toContain('- Dark mode?');
    expect(result.promptVersion.markdown).toContain(`Header (\`${header}\`): No description.`);
  });

  it('blocks open conflicts and an unconfirmed assignment', async () => {
    const first = await submit();
    // Same path without UI-ID → the second session needs a confirmed assignment (04 §3).
    const second = await submitScreenshot(
      env.ctx,
      agent,
      { projectId: first.projectId, source: 'mcp', uiPath: '/dashboard', metadata: {} },
      await makeImage('png', 1200, 900, 7),
    );
    const sessionId = second.session.id;
    describeAll(sessionId);
    edit(sessionId, {
      op: 'addConflict',
      conflictId: newId('conflict'),
      componentIds: [header],
      description: 'Sticky or not?',
    });
    const error = errorOf(() => release(sessionId));
    expect((error.details?.['blocking'] as { code: string }[]).map((issue) => issue.code)).toEqual([
      'assignment_unconfirmed',
      'open_conflict',
    ]);
    confirmAssignment(env.ctx, LOCAL_HUMAN, sessionId, { acceptProposedPath: false });
    const conflictId = getDraft(env.ctx, LOCAL_HUMAN, sessionId).conflicts[0]?.id ?? '';
    edit(sessionId, { op: 'updateConflict', conflictId, status: 'resolved', resolution: 'Sticky' });
    expect(release(sessionId).promptVersion.markdown).toContain('Resolution: Sticky');
  });

  it('only lets a human release an in-progress session with the current row version', async () => {
    const { sessionId } = await submit();
    expect(errorOf(() => release(sessionId)).code).toBe('INVALID_TRANSITION'); // awaiting_review
    describeAll(sessionId);
    const rowVersion = getSession(env.ctx, LOCAL_HUMAN, sessionId).session.rowVersion;
    expect(errorOf(() => releaseSpecification(env.ctx, agent, sessionId, { rowVersion })).code).toBe(
      'FORBIDDEN_ACTOR',
    );
    expect(
      errorOf(() => releaseSpecification(env.ctx, LOCAL_HUMAN, sessionId, { rowVersion: rowVersion - 1 }))
        .code,
    ).toBe('VERSION_CONFLICT');
    expect(
      errorOf(() => releaseSpecification(env.ctx, LOCAL_HUMAN, sessionId, { rowVersion: 'x' })).code,
    ).toBe('VALIDATION');
  });

  it('deduplicates unchanged components across versions (reopen and release again)', async () => {
    const { sessionId } = await submit();
    describeAll(sessionId);
    const v1 = release(sessionId);
    const reopened = reopenSession(env.ctx, LOCAL_HUMAN, sessionId, 'logo text wrong');
    expect(reopened).toMatchObject({
      status: 'in_progress',
      baseVersionId: v1.uiVersion.id,
      resultVersionId: null,
    });

    edit(sessionId, spec(logo, 'general', 'description', 'Shop logo (SVG)'));
    const v2 = release(sessionId, { changeDescription: 'Logo description fixed' });

    expect(v2.uiVersion).toMatchObject({ versionNo: 2, predecessorVersionId: v1.uiVersion.id });
    expect(v2.specRevision).toMatchObject({ revisionNo: 2, previousSpecRevisionId: v1.specRevision.id });
    const revisionOf = (specRevisionId: string, componentId: string) =>
      env.ctx.repos.versions
        .listSpecRevisionComponents(specRevisionId)
        .find((entry) => entry.componentId === componentId)?.componentRevisionId;
    expect(revisionOf(v2.specRevision.id, header)).toBe(revisionOf(v1.specRevision.id, header));
    expect(revisionOf(v2.specRevision.id, logo)).not.toBe(revisionOf(v1.specRevision.id, logo));
    expect(count('component_revisions')).toBe(3);
    // The first version is untouched.
    expect(getUiVersion(env.ctx, LOCAL_HUMAN, v1.uiVersion.id).promptVersion.markdown).toBe(
      v1.promptVersion.markdown,
    );
    expect(v2.promptVersion.markdown).toContain(`predecessor V1 (\`${v1.uiVersion.id}\`)`);
  });

  it('detects a parallel release and allows releasing anyway when acknowledged', async () => {
    const first = await submit();
    const second = await submit(first.projectId, first.uiId);
    describeAll(first.sessionId);
    describeAll(second.sessionId);
    const v1 = release(first.sessionId);

    const error = errorOf(() => release(second.sessionId));
    expect(error.code).toBe('VERSION_CONFLICT');
    expect(error.details).toMatchObject({
      headVersion: { id: v1.uiVersion.id, versionNo: 1 },
      baseVersion: null,
    });

    const v2 = release(second.sessionId, { conflictAcknowledged: true });
    expect(v2.uiVersion).toMatchObject({ versionNo: 2, predecessorVersionId: v1.uiVersion.id });
    const audit = env.db.get("SELECT data FROM audit_log WHERE action = 'release' AND entity_id = :id", {
      id: v2.uiVersion.id,
    });
    expect(JSON.parse(String(audit?.['data']))).toMatchObject({
      conflictAcknowledged: true,
      basedOn: null,
      predecessor: 1,
    });
  });
});

describe('revision sessions', () => {
  it('start from the base version with the same component ids and inherited regions', async () => {
    const first = await submit();
    const firstScreenshot = env.ctx.repos.screenshots.list({
      projectId: first.projectId,
      sessionId: first.sessionId,
    })[0];
    if (!firstScreenshot) throw new Error('screenshot missing');
    describeAll(first.sessionId);
    edit(
      first.sessionId,
      {
        op: 'setRegion',
        componentId: header,
        screenshotId: firstScreenshot.id,
        rect: { x: 0, y: 0, width: 1200, height: 100 },
      },
      { op: 'updateDraft', changeSummary: 'Initial', acceptance: ['Loads fast'], openQuestions: [] },
    );
    const v1 = release(first.sessionId);

    const second = await submit(first.projectId, first.uiId);
    const details = getSession(env.ctx, LOCAL_HUMAN, second.sessionId);
    expect(details.session).toMatchObject({ intent: 'revise', baseVersionId: v1.uiVersion.id });
    const draft = getDraft(env.ctx, LOCAL_HUMAN, second.sessionId);
    expect(draft).toMatchObject({
      revision: 0,
      goal: 'Build the dashboard',
      changeSummary: '',
      acceptance: ['Loads fast'],
      conflicts: [],
    });
    expect(draft.components.map((component) => [component.componentId, component.parentId])).toEqual([
      [header, null],
      [logo, header],
    ]);
    expect(draft.components[0]?.regions).toEqual([
      { screenshotId: firstScreenshot.id, x: 0, y: 0, width: 1200, height: 100 },
    ]);

    edit(second.sessionId, { op: 'updateDraft', changeSummary: 'Taller header' });
    // The inherited region blocks until it is moved onto the new screenshot.
    const blocked = errorOf(() => release(second.sessionId, { conflictAcknowledged: false }));
    expect(blocked.code).toBe('INCOMPLETE');
    expect(blocked.details).toMatchObject({
      blocking: [{ code: 'inherited_region', componentId: header, screenshotId: firstScreenshot.id }],
    });

    const newScreenshot = env.ctx.repos.screenshots.list({
      projectId: first.projectId,
      sessionId: second.sessionId,
    })[0];
    if (!newScreenshot) throw new Error('screenshot missing');
    edit(
      second.sessionId,
      {
        op: 'setRegion',
        componentId: header,
        screenshotId: newScreenshot.id,
        rect: { x: 0, y: 0, width: 1200, height: 120 },
      },
      { op: 'setRegion', componentId: header, screenshotId: firstScreenshot.id, rect: null },
    );
    const before = count('component_revisions');
    const v2 = release(second.sessionId);
    expect(v2.uiVersion).toMatchObject({ versionNo: 2, predecessorVersionId: v1.uiVersion.id });
    // Only the header changed (its region); the logo reuses its revision.
    expect(count('component_revisions')).toBe(before + 1);

    // The prompt of V2 lists the differences to V1.
    const prompt = getImplementationPrompt(env.ctx, LOCAL_HUMAN, { versionId: v2.uiVersion.id }).markdown;
    expect(prompt).toContain('## Changes compared to V1');
    expect(prompt).toContain('x 0, y 0, 1200×100 → x 0, y 0, 1200×120');
    expect(prompt).toContain(
      `### Unchanged components (existing requirements, keep as they are)\n\n- Logo (\`${logo}\`)`,
    );

    const comparison = compareUiVersions(env.ctx, LOCAL_HUMAN, v1.uiVersion.id, v2.uiVersion.id);
    expect(comparison.diff.counts).toEqual({ added: 0, removed: 0, changed: 1, unchanged: 1 });

    const history = componentHistory(env.ctx, LOCAL_HUMAN, details.uiView.id, header);
    expect(history.map((entry) => [entry.version.versionNo, entry.change?.status])).toEqual([
      [1, 'added'],
      [2, 'changed'],
    ]);
    // The logo moved to a new screenshot without changing: a new revision, but no change.
    const logoHistory = componentHistory(env.ctx, LOCAL_HUMAN, details.uiView.id, logo);
    expect(logoHistory.map((entry) => entry.change?.status)).toEqual(['added', 'unchanged']);
    expect(logoHistory[0]?.revision?.name).toBe('Logo');
    expect(errorOf(() => componentHistory(env.ctx, LOCAL_HUMAN, details.uiView.id, 'cmp_missing')).code).toBe(
      'NOT_FOUND',
    );
  });
});

describe('reading released versions', () => {
  it('hands out nothing before the release', async () => {
    const { sessionId } = await submit();
    describeAll(sessionId);
    expect(errorOf(() => getSpecification(env.ctx, agent, { sessionId }, 'json')).code).toBe('NOT_READY');
    expect(errorOf(() => getImplementationPrompt(env.ctx, agent, { sessionId })).code).toBe('NOT_READY');
  });

  it('returns JSON and Markdown specifications with references', async () => {
    const { sessionId } = await submit();
    describeAll(sessionId);
    const { uiVersion } = release(sessionId);
    const json = getSpecification(env.ctx, agent, { sessionId }, 'json');
    expect(json.content).toMatchObject({
      format: 'opsis-specification/v1',
      references: { uiVersionId: uiVersion.id, versionNo: 1, uiId: 'ui-dashboard' },
      specification: { goal: 'Build the dashboard' },
    });
    const markdown = getSpecification(env.ctx, agent, { versionId: uiVersion.id }, 'markdown');
    expect(markdown.content).toContain('# Specification: Dashboard (ui-dashboard)');
    expect(listUiVersions(env.ctx, agent, uiVersion.uiViewId).map((version) => version.id)).toEqual([
      uiVersion.id,
    ]);
  });

  it('marks the session delivered on the first prompt retrieval by an agent only', async () => {
    const { sessionId } = await submit();
    describeAll(sessionId);
    const { uiVersion } = release(sessionId);

    const byHuman = getImplementationPrompt(env.ctx, LOCAL_HUMAN, { versionId: uiVersion.id });
    expect(getSession(env.ctx, LOCAL_HUMAN, sessionId).session.status).toBe('ready');

    const first = getImplementationPrompt(env.ctx, agent, { versionId: uiVersion.id });
    expect(getSession(env.ctx, LOCAL_HUMAN, sessionId).session.status).toBe('delivered');
    const again = getImplementationPrompt(env.ctx, agent, { sessionId });
    expect(again).toEqual(first);
    expect(first.markdown).toBe(byHuman.markdown);

    // Delivered is terminal: no reopening (decision E3).
    expect(errorOf(() => reopenSession(env.ctx, LOCAL_HUMAN, sessionId, 'too late')).code).toBe(
      'INVALID_TRANSITION',
    );
  });

  it('hides versions of foreign projects from agents', async () => {
    const { sessionId } = await submit();
    describeAll(sessionId);
    const { uiVersion } = release(sessionId);
    const stranger: Actor = { type: 'agent', id: 'agt_b', name: 'b' };
    insertAgent(env.db, stranger.id);
    expect(errorOf(() => getUiVersion(env.ctx, stranger, uiVersion.id)).code).toBe('NOT_FOUND');
    expect(errorOf(() => getImplementationPrompt(env.ctx, stranger, { sessionId })).code).toBe('NOT_FOUND');
  });
});
