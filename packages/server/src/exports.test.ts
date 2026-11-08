import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LOCAL_HUMAN,
  OpsisError,
  buildAnnotation,
  changeDraft,
  createProject,
  exportVersion,
  getDraft,
  getSession,
  getSpecification,
  newId,
  releaseSpecification,
  submitScreenshot,
  type Actor,
  type DraftOperation,
} from '@opsis/core';
import { annotationSvg, escapeXml } from './infrastructure/files/annotator.js';
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

const header = newId('component');
const logo = newId('component');
const decoder = new TextDecoder();

/** A released V1 with a header (depth 0) and a logo inside it (depth 1). */
const releasedVersion = async () => {
  const projectId = createProject(env.ctx, agent, { name: 'Shop' }).id;
  const original = await makeImage('png', 1200, 900);
  const submitted = await submitScreenshot(
    env.ctx,
    agent,
    { projectId, source: 'mcp', uiPath: '/dashboard', metadata: {} },
    original,
  );
  const sessionId = submitted.session.id;
  const screenshotId = submitted.screenshot.id;
  const operations: DraftOperation[] = [
    {
      op: 'addComponent',
      componentId: header,
      parentId: null,
      name: 'Header <&>',
      kind: 'container',
      region: { screenshotId, x: 100, y: 100, width: 400, height: 200 },
    },
    {
      op: 'addComponent',
      componentId: logo,
      parentId: header,
      name: 'Logo',
      kind: 'visual_area',
      region: { screenshotId, x: 120, y: 130, width: 100, height: 50 },
    },
  ];
  changeDraft(env.ctx, LOCAL_HUMAN, sessionId, { baseRevision: 0, operations });
  const draft = getDraft(env.ctx, LOCAL_HUMAN, sessionId);
  expect(draft.components).toHaveLength(2);
  const result = releaseSpecification(env.ctx, LOCAL_HUMAN, sessionId, {
    rowVersion: getSession(env.ctx, LOCAL_HUMAN, sessionId).session.rowVersion,
    acknowledgedWarnings: [
      `missing_description:${header}`,
      `missing_acceptance:${header}`,
      `missing_description:${logo}`,
      `missing_acceptance:${logo}`,
    ],
  });
  return { sessionId, screenshotId, original, versionId: result.uiVersion.id };
};

const exportError = async (work: Promise<unknown>): Promise<OpsisError> => {
  try {
    await work;
  } catch (error) {
    if (error instanceof OpsisError) return error;
    throw error;
  }
  throw new Error('expected an OpsisError');
};

const pixel = async (png: Uint8Array, x: number, y: number): Promise<number[]> => {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return [...data.subarray(offset, offset + 3)];
};

describe('exportVersion', () => {
  it('exports the opsis-export/v1 document deterministically', async () => {
    const { versionId, sessionId, screenshotId } = await releasedVersion();
    const first = await exportVersion(env.ctx, LOCAL_HUMAN, versionId, { kind: 'json' });
    const second = await exportVersion(env.ctx, LOCAL_HUMAN, versionId, { kind: 'json' });

    expect(first.filename).toBe('ui-dashboard-v1.opsis.json');
    expect(first.contentType).toBe('application/json; charset=utf-8');
    expect(Buffer.from(first.bytes).equals(Buffer.from(second.bytes))).toBe(true);
    const document = JSON.parse(decoder.decode(first.bytes)) as Record<string, unknown>;
    expect(document).toMatchObject({
      format: 'opsis-export/v1',
      ids: { uiVersionId: versionId, sessionId, uiId: 'ui-dashboard' },
      screenshots: [{ id: screenshotId, width: 1200, height: 900 }],
      specification: { format: 'opsis-specification/v1' },
    });
  });

  it('exports specification and prompt Markdown without delivering the session', async () => {
    const { versionId, sessionId } = await releasedVersion();
    const specification = await exportVersion(env.ctx, LOCAL_HUMAN, versionId, { kind: 'specification' });
    expect(specification.filename).toBe('ui-dashboard-v1-specification.md');
    expect(decoder.decode(specification.bytes)).toBe(
      getSpecification(env.ctx, LOCAL_HUMAN, { versionId }, 'markdown').content,
    );

    const prompt = await exportVersion(env.ctx, agent, versionId, { kind: 'prompt' });
    expect(prompt.filename).toBe('ui-dashboard-v1-prompt.md');
    expect(decoder.decode(prompt.bytes)).toContain('# Implementation prompt: Dashboard (ui-dashboard)');
    expect(getSession(env.ctx, LOCAL_HUMAN, sessionId).session.status).toBe('ready');
  });

  it('exports the original screenshot byte for byte', async () => {
    const { versionId, original, screenshotId } = await releasedVersion();
    const file = await exportVersion(env.ctx, LOCAL_HUMAN, versionId, { kind: 'screenshot', screenshotId });
    expect(file).toMatchObject({ filename: 'ui-dashboard-v1-screenshot-1.png', contentType: 'image/png' });
    expect(Buffer.from(file.bytes).equals(Buffer.from(original))).toBe(true);
  });

  it('draws frames coloured by depth onto the annotated screenshot', async () => {
    const { versionId } = await releasedVersion();
    const file = await exportVersion(env.ctx, LOCAL_HUMAN, versionId, { kind: 'annotated' });
    expect(file).toMatchObject({
      filename: 'ui-dashboard-v1-screenshot-1-annotated.png',
      contentType: 'image/png',
    });
    const metadata = await sharp(file.bytes).metadata();
    expect([metadata.format, metadata.width, metadata.height]).toEqual(['png', 1200, 900]);
    expect(await pixel(file.bytes, 101, 250)).toEqual([0xe8, 0x59, 0x0c]); // header, depth 0
    expect(await pixel(file.bytes, 121, 170)).toEqual([0x1c, 0x7e, 0xd6]); // logo, depth 1
    expect(await pixel(file.bytes, 350, 250)).toEqual([0, 120, 200]); // untouched
  });

  it('rejects unknown screenshots, misplaced screenshot ids and unknown kinds', async () => {
    const { versionId, screenshotId } = await releasedVersion();
    expect(
      (
        await exportError(
          exportVersion(env.ctx, LOCAL_HUMAN, versionId, { kind: 'annotated', screenshotId: 'scr_x' }),
        )
      ).code,
    ).toBe('NOT_FOUND');
    expect(
      (await exportError(exportVersion(env.ctx, LOCAL_HUMAN, versionId, { kind: 'json', screenshotId })))
        .code,
    ).toBe('VALIDATION');
    expect((await exportError(exportVersion(env.ctx, LOCAL_HUMAN, versionId, { kind: 'zip' }))).code).toBe(
      'VALIDATION',
    );
    expect(
      (await exportError(exportVersion(env.ctx, LOCAL_HUMAN, 'uvr_missing', { kind: 'json' }))).code,
    ).toBe('NOT_FOUND');
  });
});

describe('annotation overlay', () => {
  it('escapes user text and keeps tags inside the image', async () => {
    const { versionId } = await releasedVersion();
    const released = await exportVersion(env.ctx, LOCAL_HUMAN, versionId, { kind: 'json' });
    const document = JSON.parse(decoder.decode(released.bytes)) as {
      specification: { specification: Parameters<typeof buildAnnotation>[0] };
    };
    const snapshot = document.specification.specification;
    const annotation = buildAnnotation(snapshot, snapshot.primaryScreenshotId);
    expect(annotation.marks.map((mark) => [mark.name, mark.depth])).toEqual([
      ['Header <&>', 0],
      ['Logo', 1],
    ]);

    const svg = annotationSvg(annotation);
    expect(svg).toContain('>Header &lt;&amp;&gt;</text>');
    expect(svg).not.toContain('<&>');
    expect(escapeXml('a\u0001"\'b')).toBe('a&quot;&apos;b');

    const [headerMark] = annotation.marks;
    if (!headerMark) throw new Error('header mark missing');
    const wide = annotationSvg({
      screenshotId: 'scr_x',
      width: 200,
      height: 100,
      marks: [{ ...headerMark, name: 'x'.repeat(200), x: 150, y: 0 }],
    });
    // Tag at the right image edge, inside the frame (no room above), name shortened.
    expect(wide).toMatch(/<rect x="(\d+)" y="0" width="(\d+)" height="\d+" fill="#e8590c"\/>/);
    const [, x, width] = /<rect x="(\d+)" y="0" width="(\d+)" height="\d+" fill=/.exec(wide) ?? [];
    expect(Number(x) + Number(width)).toBeLessThanOrEqual(200);
    expect(wide).toContain('…</text>');
  });
});
