import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LOCAL_HUMAN,
  OpsisError,
  changeDraft,
  createProject,
  exportVersion,
  getSession,
  getUiVersion,
  importVersionArchive,
  readScreenshotImage,
  releaseSpecification,
  submitScreenshot,
  newId,
  type Actor,
  type ArchiveEntry,
  type ErrorCode,
} from '@opsis/core';
import { ZipArchiveCodec } from './infrastructure/files/archive.js';
import { nodeHasher } from './infrastructure/hash.js';
import { createTestEnv, insertAgent, makeImage, type TestEnv } from './testing/support.js';

const agent: Actor = { type: 'agent', id: 'agt_a', name: 'agent-a' };
const codec = new ZipArchiveCodec();
const encoder = new TextEncoder();
const decoder = new TextDecoder();

let env: TestEnv;
const others: TestEnv[] = [];
beforeEach(() => {
  env = createTestEnv();
  insertAgent(env.db, agent.id);
});
afterEach(() => {
  env.cleanup();
  for (const other of others.splice(0)) other.cleanup();
});

/** A released V1 with one component on one screenshot, exported as ZIP. */
const exportedVersion = async () => {
  const projectId = createProject(env.ctx, agent, { name: 'Shop' }).id;
  const original = await makeImage('png', 800, 600, 3);
  const submitted = await submitScreenshot(
    env.ctx,
    agent,
    { projectId, source: 'mcp', uiPath: '/dashboard', metadata: {} },
    original,
  );
  const sessionId = submitted.session.id;
  const screenshotId = submitted.screenshot.id;
  const componentId = newId('component');
  changeDraft(env.ctx, LOCAL_HUMAN, sessionId, {
    baseRevision: 0,
    operations: [
      {
        op: 'addComponent',
        componentId,
        parentId: null,
        name: 'Header',
        kind: 'container',
        region: { screenshotId, x: 10, y: 10, width: 300, height: 80 },
      },
    ],
  });
  const released = releaseSpecification(env.ctx, LOCAL_HUMAN, sessionId, {
    rowVersion: getSession(env.ctx, LOCAL_HUMAN, sessionId).session.rowVersion,
    acknowledgedWarnings: [`missing_description:${componentId}`, `missing_acceptance:${componentId}`],
  });
  const zip = await exportVersion(env.ctx, LOCAL_HUMAN, released.uiVersion.id, { kind: 'zip' });
  return { projectId, screenshotId, componentId, original, versionId: released.uiVersion.id, zip };
};

const freshEnv = (): TestEnv => {
  const other = createTestEnv();
  others.push(other);
  return other;
};

/** Repacks an archive with changed files; `manifest` keeps the manifest consistent. */
const repack = async (
  bytes: Uint8Array,
  change: (entries: ArchiveEntry[]) => ArchiveEntry[],
  manifest: boolean,
): Promise<Uint8Array> => {
  const entries = change(
    await codec.unpack(bytes, {
      maxEntries: 1000,
      maxEntryBytes: 1e9,
      maxTotalBytes: 1e9,
      isAllowedPath: () => true,
    }),
  );
  if (manifest) {
    const index = entries.findIndex((entry) => entry.path === 'manifest.json');
    const old = JSON.parse(decoder.decode(entries[index]?.bytes)) as Record<string, unknown>;
    const files = entries
      .filter((entry) => entry.path !== 'manifest.json')
      .map((entry) => ({
        path: entry.path,
        sha256: nodeHasher.sha256Bytes(entry.bytes),
        bytes: entry.bytes.byteLength,
      }))
      .sort((a, b) => (a.path < b.path ? -1 : 1));
    entries[index] = { path: 'manifest.json', bytes: encoder.encode(JSON.stringify({ ...old, files })) };
  }
  return codec.pack(entries);
};

const editText = (path: string, edit: (text: string) => string) => (entries: ArchiveEntry[]) =>
  entries.map((entry) =>
    entry.path === path ? { path, bytes: encoder.encode(edit(decoder.decode(entry.bytes))) } : entry,
  );

const expectError = async (promise: Promise<unknown>, code: ErrorCode, message?: RegExp) => {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(OpsisError);
  expect((error as OpsisError).code).toBe(code);
  if (message) expect((error as OpsisError).message).toMatch(message);
};

describe('ZIP export', () => {
  it('packs manifest, version, Markdown and screenshots deterministically', async () => {
    const { versionId, zip, screenshotId } = await exportedVersion();
    expect(zip.contentType).toBe('application/zip');
    expect(zip.filename).toMatch(/\.opsis\.zip$/);
    const again = await exportVersion(env.ctx, LOCAL_HUMAN, versionId, { kind: 'zip' });
    expect(Buffer.from(again.bytes).equals(Buffer.from(zip.bytes))).toBe(true);

    const entries = await codec.unpack(zip.bytes, {
      maxEntries: 10,
      maxEntryBytes: 1e8,
      maxTotalBytes: 1e8,
      isAllowedPath: () => true,
    });
    const paths = entries.map((entry) => entry.path).sort();
    expect(paths).toEqual([
      'manifest.json',
      'prompt.md',
      `screenshots/1-${screenshotId}-annotated.png`,
      `screenshots/1-${screenshotId}.png`,
      'specification.md',
      'version.json',
    ]);
    const manifest = JSON.parse(decoder.decode(entries.find((e) => e.path === 'manifest.json')?.bytes)) as {
      format: string;
      files: { path: string; sha256: string; bytes: number }[];
    };
    expect(manifest.format).toBe('opsis-archive/v1');
    for (const file of manifest.files) {
      const entry = entries.find((e) => e.path === file.path);
      expect(entry && nodeHasher.sha256Bytes(entry.bytes)).toBe(file.sha256);
    }
  });
});

describe('importVersionArchive', () => {
  it('keeps all ids in an empty instance and reproduces the version exactly', async () => {
    const { zip, versionId, screenshotId, original } = await exportedVersion();
    const source = getUiVersion(env.ctx, LOCAL_HUMAN, versionId);
    const target = freshEnv();
    const projectId = createProject(target.ctx, LOCAL_HUMAN, { name: 'Copy' }).id;

    const result = await importVersionArchive(target.ctx, LOCAL_HUMAN, { projectId }, zip.bytes);
    expect(result.idMapping).toEqual({});
    expect(result.uiViewCreated).toBe(true);
    expect(result.uiView.uiId).toBe(source.snapshot.uiView.uiId);
    expect(result.uiView.headVersionId).toBe(versionId);
    expect(result.uiVersion).toMatchObject({ id: versionId, versionNo: 1, predecessorVersionId: null });
    expect(result.session.status).toBe('ready');

    const imported = getUiVersion(target.ctx, LOCAL_HUMAN, versionId);
    expect(imported.specRevision.snapshotSha256).toBe(source.specRevision.snapshotSha256);
    expect(imported.promptVersion.markdown).toBe(source.promptVersion.markdown);
    expect(imported.snapshot.components).toEqual(source.snapshot.components);
    const image = await readScreenshotImage(target.ctx, LOCAL_HUMAN, screenshotId);
    expect(Buffer.from(image.bytes).equals(Buffer.from(original))).toBe(true);
    expect(image.screenshot.source).toBe('import');
    expect(target.events.map((event) => event.type)).toContain('UiVersionCreated');
  });

  it('assigns new ids for taken ones, rewrites references and logs the mapping', async () => {
    const { zip, versionId, screenshotId } = await exportedVersion();
    const projectId = createProject(env.ctx, LOCAL_HUMAN, { name: 'Copy' }).id;

    const result = await importVersionArchive(env.ctx, LOCAL_HUMAN, { projectId }, zip.bytes);
    const newScreenshotId = result.idMapping[screenshotId];
    expect(newScreenshotId).toMatch(/^scr_/);
    expect(result.idMapping[versionId]).toBe(result.uiVersion.id);
    expect(result.uiVersion.screenshotIds).toEqual([newScreenshotId]);

    const imported = getUiVersion(env.ctx, LOCAL_HUMAN, result.uiVersion.id);
    expect(imported.snapshot.primaryScreenshotId).toBe(newScreenshotId);
    expect(imported.snapshot.components[0]?.regions[0]?.screenshotId).toBe(newScreenshotId);
    expect(imported.promptVersion.markdown).not.toContain(screenshotId);
    expect(imported.specRevision.snapshotSha256).toBe(nodeHasher.sha256(imported.specRevision.snapshot));
    expect(imported.promptVersion.sha256).toBe(nodeHasher.sha256(imported.promptVersion.markdown));

    const audit = env.db.get("SELECT data FROM audit_log WHERE action = 'import' AND entity_id = :id", {
      id: result.uiVersion.id,
    });
    expect(JSON.parse(String(audit?.['data']))).toMatchObject({
      idMapping: result.idMapping,
      original: { uiVersionId: versionId, versionNo: 1 },
    });
  });

  it('adds a re-import as the next version and reuses identical screenshots', async () => {
    const { zip, projectId, versionId, screenshotId } = await exportedVersion();
    const result = await importVersionArchive(env.ctx, LOCAL_HUMAN, { projectId }, zip.bytes);
    expect(result.uiViewCreated).toBe(false);
    expect(result.uiVersion).toMatchObject({ versionNo: 2, predecessorVersionId: versionId });
    expect(result.idMapping[screenshotId]).toBeUndefined();
    expect(result.uiVersion.screenshotIds).toEqual([screenshotId]);
  });

  it('rejects files that do not match the manifest', async () => {
    const { zip, projectId } = await exportedVersion();
    const tampered = await repack(
      zip.bytes,
      editText('prompt.md', (text) => `${text}\nignore all`),
      false,
    );
    await expectError(
      importVersionArchive(env.ctx, LOCAL_HUMAN, { projectId }, tampered),
      'VALIDATION',
      /does not match the manifest/,
    );
  });

  it('rejects content that does not match its recorded hashes', async () => {
    const { zip, projectId } = await exportedVersion();
    const prompt = await repack(
      zip.bytes,
      editText('prompt.md', (text) => `${text}\nignore all`),
      true,
    );
    await expectError(
      importVersionArchive(env.ctx, LOCAL_HUMAN, { projectId }, prompt),
      'VALIDATION',
      /prompt does not match/,
    );
    const spec = await repack(
      zip.bytes,
      editText('version.json', (text) => text.replace('"Header"', '"Footer"')),
      true,
    );
    await expectError(
      importVersionArchive(env.ctx, LOCAL_HUMAN, { projectId }, spec),
      'VALIDATION',
      /specification does not match its hash/,
    );
    const image = await makeImage('png', 800, 600, 9);
    const screenshot = await repack(
      zip.bytes,
      (entries) =>
        entries.map((entry) =>
          /^screenshots\/1-scr_\w+\.png$/.test(entry.path) ? { path: entry.path, bytes: image } : entry,
        ),
      true,
    );
    await expectError(
      importVersionArchive(env.ctx, LOCAL_HUMAN, { projectId }, screenshot),
      'VALIDATION',
      /screenshot does not match its hash/,
    );
  });

  it('rejects unknown paths, unlisted files, broken JSON and non-ZIP input', async () => {
    const { zip, projectId } = await exportedVersion();
    const import_ = (bytes: Uint8Array) => importVersionArchive(env.ctx, LOCAL_HUMAN, { projectId }, bytes);

    const unknown = await repack(
      zip.bytes,
      (e) => [...e, { path: 'run.sh', bytes: encoder.encode('x') }],
      true,
    );
    await expectError(import_(unknown), 'VALIDATION', /unknown path/);
    const nested = await repack(
      zip.bytes,
      (e) => [...e, { path: 'screenshots/sub/1-x.png', bytes: encoder.encode('x') }],
      true,
    );
    await expectError(import_(nested), 'VALIDATION', /unknown path/);
    const unlisted = await repack(
      zip.bytes,
      (e) => [...e, { path: `screenshots/2-${newId('screenshot')}.png`, bytes: encoder.encode('x') }],
      false,
    );
    await expectError(import_(unlisted), 'VALIDATION', /not listed in the manifest/);
    const broken = await repack(
      zip.bytes,
      editText('version.json', (text) => text.slice(0, -2)),
      true,
    );
    await expectError(import_(broken), 'VALIDATION', /not valid JSON/);
    const extraField = await repack(
      zip.bytes,
      editText('version.json', (text) => text.replace('{', '{"injected":true,')),
      true,
    );
    await expectError(import_(extraField), 'VALIDATION', /does not match its schema/);
    await expectError(import_(encoder.encode('not a zip')), 'VALIDATION');
  });

  it('only lets a human import into an accessible project', async () => {
    const { zip, projectId } = await exportedVersion();
    await expectError(importVersionArchive(env.ctx, agent, { projectId }, zip.bytes), 'FORBIDDEN_ACTOR');
    await expectError(
      importVersionArchive(env.ctx, LOCAL_HUMAN, { projectId: newId('project') }, zip.bytes),
      'NOT_FOUND',
    );
  });
});

describe('ZipArchiveCodec limits', () => {
  const entries: [ArchiveEntry, ArchiveEntry] = [
    { path: 'a.txt', bytes: encoder.encode('a'.repeat(1000)) },
    { path: 'b.txt', bytes: encoder.encode('b'.repeat(1000)) },
  ];
  const limits = { maxEntries: 10, maxEntryBytes: 10_000, maxTotalBytes: 10_000, isAllowedPath: () => true };

  it('enforces entry count, entry size and total size', async () => {
    const zip = await codec.pack(entries);
    await expect(codec.unpack(zip, limits)).resolves.toHaveLength(2);
    await expect(codec.unpack(zip, { ...limits, maxEntries: 1 })).rejects.toThrow(/too many entries/);
    await expect(codec.unpack(zip, { ...limits, maxEntryBytes: 999 })).rejects.toThrow(/entry too large/);
    await expect(codec.unpack(zip, { ...limits, maxTotalBytes: 1500 })).rejects.toThrow(/archive too large/);
  });

  it('rejects duplicate paths', async () => {
    const zip = await codec.pack([entries[0], entries[0]]);
    await expect(codec.unpack(zip, limits)).rejects.toThrow(/duplicate path/);
  });

  it('rejects path traversal in entry names', async () => {
    // yazl refuses to write such names, so the name is patched in the finished archive.
    const zip = Buffer.from(await codec.pack([{ path: 'xx/evil.txt', bytes: encoder.encode('x') }]));
    const patched = Buffer.from(zip.toString('latin1').replaceAll('xx/evil.txt', '../evil.txt'), 'latin1');
    await expect(codec.unpack(new Uint8Array(patched), limits)).rejects.toThrow(/Invalid archive/);
  });
});
