/**
 * File exports of a released UI version (architecture 05 §7). Everything is derived from
 * the immutable history – the stored snapshot, the stored prompt and the content-addressed
 * screenshot blobs – so an export of the same version is always the same file. The ZIP
 * bundle with manifest follows in phase 4.
 */
import { z } from 'zod';
import type { Actor } from '../domain/actor.js';
import { OpsisError } from '../domain/errors.js';
import { buildAnnotation } from '../domain/specification/annotation.js';
import { renderSpecificationMarkdown } from '../domain/specification/markdown.js';
import { buildSpecificationDocument, type SnapshotScreenshot } from '../domain/specification/snapshot.js';
import { parseInput, type AppContext } from './context.js';
import type { PixelDiffResult } from './ports.js';
import { getUiVersion, type ReleasedVersion } from './versions.js';

export const EXPORT_FORMAT = 'opsis-export/v1';

export const EXPORT_KINDS = ['json', 'specification', 'prompt', 'screenshot', 'annotated'] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export const ExportInputSchema = z.strictObject({
  kind: z.enum(EXPORT_KINDS),
  /** Screenshot exports only; defaults to the primary screenshot. */
  screenshotId: z.string().min(1).max(64).optional(),
});
export type ExportInput = z.input<typeof ExportInputSchema>;

export interface ExportFile {
  readonly filename: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** `opsis-export/v1`: all ids of the version plus snapshot and screenshot metadata. */
export const buildExportDocument = (released: ReleasedVersion) => {
  const { uiVersion, specRevision, promptVersion, snapshot, references } = released;
  return {
    format: EXPORT_FORMAT,
    ids: {
      projectId: uiVersion.projectId,
      uiViewId: uiVersion.uiViewId,
      uiId: snapshot.uiView.uiId,
      sessionId: uiVersion.sessionId,
      uiVersionId: uiVersion.id,
      specRevisionId: specRevision.id,
      promptVersionId: promptVersion.id,
    },
    uiVersion,
    specRevision: {
      id: specRevision.id,
      revisionNo: specRevision.revisionNo,
      snapshotSha256: specRevision.snapshotSha256,
      previousSpecRevisionId: specRevision.previousSpecRevisionId,
      releasedBy: specRevision.releasedBy,
      releasedAt: specRevision.releasedAt,
    },
    promptVersion: {
      id: promptVersion.id,
      generatorVersion: promptVersion.generatorVersion,
      sha256: promptVersion.sha256,
      createdAt: promptVersion.createdAt,
    },
    screenshots: snapshot.screenshots,
    specification: buildSpecificationDocument(snapshot, references, promptVersion.generatorVersion),
  };
};

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

const pickScreenshot = (released: ReleasedVersion, screenshotId: string | undefined): SnapshotScreenshot => {
  const id = screenshotId ?? released.snapshot.primaryScreenshotId;
  const screenshot = released.snapshot.screenshots.find((candidate) => candidate.id === id);
  if (!screenshot) {
    throw new OpsisError('NOT_FOUND', `Screenshot "${id}" is not part of version "${released.uiVersion.id}"`);
  }
  return screenshot;
};

export const exportVersion = async (
  ctx: AppContext,
  actor: Actor,
  versionId: string,
  raw: unknown,
): Promise<ExportFile> => {
  const input = parseInput(ExportInputSchema, raw);
  const released = getUiVersion(ctx, actor, versionId);
  // uiId is restricted to [a-z0-9-], so the file name needs no further escaping.
  const base = `${released.snapshot.uiView.uiId}-v${String(released.uiVersion.versionNo)}`;
  if (input.kind !== 'screenshot' && input.kind !== 'annotated' && input.screenshotId !== undefined) {
    throw new OpsisError('VALIDATION', 'screenshotId is only allowed for screenshot exports');
  }

  switch (input.kind) {
    case 'json':
      return {
        filename: `${base}.opsis.json`,
        contentType: 'application/json; charset=utf-8',
        bytes: text(`${JSON.stringify(buildExportDocument(released), null, 2)}\n`),
      };
    case 'specification':
      return {
        filename: `${base}-specification.md`,
        contentType: 'text/markdown; charset=utf-8',
        bytes: text(renderSpecificationMarkdown(released.snapshot, released.references)),
      };
    case 'prompt':
      // A download by the human never counts as delivery to the agent (decision E3).
      return {
        filename: `${base}-prompt.md`,
        contentType: 'text/markdown; charset=utf-8',
        bytes: text(released.promptVersion.markdown),
      };
    case 'screenshot': {
      const screenshot = pickScreenshot(released, input.screenshotId);
      return {
        filename: `${base}-screenshot-${String(screenshot.sequenceNo)}.${EXTENSIONS[screenshot.mimeType] ?? 'bin'}`,
        contentType: screenshot.mimeType,
        bytes: await ctx.blobs.read(screenshot.sha256),
      };
    }
    case 'annotated': {
      const screenshot = pickScreenshot(released, input.screenshotId);
      const original = await ctx.blobs.read(screenshot.sha256);
      return {
        filename: `${base}-screenshot-${String(screenshot.sequenceNo)}-annotated.png`,
        contentType: 'image/png',
        bytes: await ctx.annotator.annotate(original, buildAnnotation(released.snapshot, screenshot.id)),
      };
    }
  }
};

export const PixelDiffInputSchema = z.strictObject({
  /** Screenshots to compare; default: the primary screenshot of each version. */
  screenshotA: z.string().min(1).max(64).optional(),
  screenshotB: z.string().min(1).max(64).optional(),
});

export interface PixelDiff extends Omit<PixelDiffResult, 'png'> {
  readonly screenshotA: string;
  readonly screenshotB: string;
  readonly png: Uint8Array;
}

/**
 * Detected pixel differences between screenshots of two versions of the same UI. Only a
 * finding: OPSIS does not judge whether a difference is intended.
 */
export const pixelDiff = async (
  ctx: AppContext,
  actor: Actor,
  versionIdA: string,
  versionIdB: string,
  raw: unknown,
): Promise<PixelDiff> => {
  const input = parseInput(PixelDiffInputSchema, raw);
  const a = getUiVersion(ctx, actor, versionIdA);
  const b = getUiVersion(ctx, actor, versionIdB);
  if (a.uiVersion.uiViewId !== b.uiVersion.uiViewId) {
    throw new OpsisError('VALIDATION', 'Only versions of the same UI can be compared');
  }
  const screenshotA = pickScreenshot(a, input.screenshotA);
  const screenshotB = pickScreenshot(b, input.screenshotB);
  const result = await ctx.differ.diff(
    await ctx.blobs.read(screenshotA.sha256),
    await ctx.blobs.read(screenshotB.sha256),
  );
  return { ...result, screenshotA: screenshotA.id, screenshotB: screenshotB.id };
};
