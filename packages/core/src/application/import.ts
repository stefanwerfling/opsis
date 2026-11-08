/**
 * ZIP import of a released version (architecture 05 §7, decision E6).
 *
 * Everything is checked before anything is stored: allowed paths and limits (archive
 * codec), the manifest with SHA-256 and size of every file, the schemas of manifest and
 * version document, the snapshot hash, the prompt hash, the screenshot hashes and a full
 * decode of every image, plus the internal references of the snapshot.
 *
 * The imported version is a new immutable record on top of the target UI's head. Snapshot
 * and prompt are taken over verbatim (they are the released content). Record ids are kept
 * when free; otherwise new ids are assigned and the mapping is written to the audit log.
 * Screenshots are referenced by id inside the snapshot, so an existing screenshot with the
 * same id is reused only if it is the same image in the same project.
 */
import { z } from 'zod';
import { actorRef, type Actor } from '../domain/actor.js';
import { BLOCKING_CODES, WARNING_CODES } from '../domain/completeness.js';
import { OpsisError } from '../domain/errors.js';
import { ID_PATTERN, newId, type IdKind } from '../domain/ids.js';
import type { Screenshot } from '../domain/screenshot.js';
import type { Session } from '../domain/session.js';
import { canonicalJson } from '../domain/specification/canonical-json.js';
import {
  SNAPSHOT_FORMAT,
  SPECIFICATION_FORMAT,
  type SpecSnapshot,
} from '../domain/specification/snapshot.js';
import { UiIdSchema, UiPathSchema, type UiView } from '../domain/ui-view.js';
import type { PromptVersion, SpecRevision, UiVersion } from '../domain/version.js';
import {
  COMPONENT_KINDS,
  CONFLICT_STATUSES,
  DEVICE_CATEGORIES,
  DRAFT_LIMITS,
  IMAGE_LIMITS,
  IMAGE_MIME_TYPES,
  PROMPT_LANGUAGES,
  RELATION_KINDS,
  SPEC_GROUPS,
  SPEC_ORIGINS,
} from '../domain/vocabulary.js';
import { commit, parseInput, type AppContext } from './context.js';
import { ARCHIVE_FORMAT, ARCHIVE_PATH_PATTERN, ARCHIVE_PATHS, EXPORT_FORMAT } from './exports.js';
import { storeComponentRevisions, storeComponentTree } from './history-store.js';
import type { ArchiveEntry, BlobRecord } from './ports.js';
import { recordStatusEvent } from './sessions.js';
import { insertUiView } from './ui-views.js';

/** An id anywhere inside a text. */
const ID_TOKEN = /[a-z]{3}_[0-9A-HJKMNP-TV-Z]{26}/g;

export const IMPORT_LIMITS = {
  maxScreenshots: 50,
  /** Per file; annotated PNGs of large screenshots can exceed the image upload limit. */
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
  /** Size of the uploaded ZIP itself. */
  maxArchiveBytes: 256 * 1024 * 1024,
} as const;

// ── Schemas ───────────────────────────────────────────────────────────────────

const Id = z.string().regex(ID_PATTERN);
const Text = z.string().max(DRAFT_LIMITS.maxTextLength);
const Name = z.string().max(DRAFT_LIMITS.maxNameLength);
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const Timestamp = z.string().min(1).max(40);
const Count = z.number().int().min(0);
const VersionRef = z.strictObject({ id: Id, versionNo: z.number().int().min(1) });
const Coordinate = z.number().min(0).max(IMAGE_LIMITS.maxEdgePx);
const Size = z.number().positive().max(IMAGE_LIMITS.maxEdgePx);
const Edge = z.number().int().min(1).max(IMAGE_LIMITS.maxEdgePx);

const SpecValueSchema = z.strictObject({ value: Text, origin: z.enum(SPEC_ORIGINS), note: Text.optional() });
const ComponentSpecSchema = z
  .record(z.string(), z.record(z.string(), SpecValueSchema))
  .superRefine((spec, refinement) => {
    for (const [group, fields] of Object.entries(spec)) {
      const known: readonly string[] | undefined = (SPEC_GROUPS as Record<string, readonly string[]>)[group];
      if (!known) refinement.addIssue({ code: 'custom', message: `unknown spec group "${group}"` });
      for (const field of Object.keys(fields)) {
        if (known && !known.includes(field)) {
          refinement.addIssue({ code: 'custom', message: `unknown spec field "${group}.${field}"` });
        }
      }
    }
  });

const IssueSchema = z.strictObject({
  id: z.string().max(400),
  severity: z.enum(['blocking', 'warning']),
  code: z.enum([...BLOCKING_CODES, ...WARNING_CODES]),
  componentId: Id.optional(),
  relationId: Id.optional(),
  conflictId: Id.optional(),
  screenshotId: Id.optional(),
  field: z.string().max(100).optional(),
});

const SnapshotScreenshotSchema = z.strictObject({
  id: Id,
  sequenceNo: z.number().int().min(1),
  mimeType: z.enum(IMAGE_MIME_TYPES),
  sha256: Sha256,
  width: Edge,
  height: Edge,
  viewportWidth: Edge.nullable(),
  viewportHeight: Edge.nullable(),
  deviceCategory: z.enum(DEVICE_CATEGORIES),
  variantLabel: z.string().max(200).nullable(),
  capturedAt: Timestamp.nullable(),
  description: Text,
});

const SnapshotSchema = z.strictObject({
  format: z.literal(SNAPSHOT_FORMAT),
  project: z.strictObject({
    id: Id,
    slug: z.string().max(200),
    name: Name,
    description: Text,
    promptLanguage: z.enum(PROMPT_LANGUAGES),
  }),
  uiView: z.strictObject({ id: Id, uiId: UiIdSchema, path: UiPathSchema, name: Name, description: Text }),
  session: z.strictObject({
    id: Id,
    title: z.string().max(500),
    intent: z.enum(['create', 'revise']),
    agentId: z.string().min(1).max(64).nullable(),
    agentSessionRef: z.string().max(500).nullable(),
  }),
  baseVersion: VersionRef.nullable(),
  rebasedFrom: VersionRef.optional(),
  primaryScreenshotId: Id,
  screenshots: z.array(SnapshotScreenshotSchema).min(1).max(IMPORT_LIMITS.maxScreenshots),
  goal: Text,
  changeSummary: Text,
  acceptance: z.array(Text).max(DRAFT_LIMITS.maxListItems),
  openQuestions: z.array(Text).max(DRAFT_LIMITS.maxListItems),
  components: z
    .array(
      z.strictObject({
        componentId: Id,
        parentId: Id.nullable(),
        order: Count,
        name: Name,
        kind: z.enum(COMPONENT_KINDS),
        spec: ComponentSpecSchema,
        regions: z
          .array(
            z.strictObject({ screenshotId: Id, x: Coordinate, y: Coordinate, width: Size, height: Size }),
          )
          .max(IMPORT_LIMITS.maxScreenshots),
      }),
    )
    .max(DRAFT_LIMITS.maxComponents),
  relations: z
    .array(
      z.strictObject({
        id: Id,
        fromComponentId: Id,
        toComponentId: Id,
        kind: z.enum(RELATION_KINDS),
        description: Text,
      }),
    )
    .max(DRAFT_LIMITS.maxRelations),
  conflicts: z
    .array(
      z.strictObject({
        id: Id,
        componentIds: z.array(Id).max(DRAFT_LIMITS.maxComponents),
        description: Text,
        status: z.enum(CONFLICT_STATUSES),
        resolution: Text,
      }),
    )
    .max(DRAFT_LIMITS.maxConflicts),
  completeness: z.strictObject({
    blocking: z.array(IssueSchema).max(100_000),
    warnings: z.array(IssueSchema).max(100_000),
    unknownFields: z
      .array(z.strictObject({ componentId: Id, fields: z.array(z.string().max(100)).max(1000) }))
      .max(DRAFT_LIMITS.maxComponents),
    counts: z.strictObject({ components: Count, specifiedFields: Count, totalFields: Count }),
  }),
  acknowledgedWarnings: z.array(z.string().max(400)).max(100_000),
});

const ExportDocumentSchema = z.strictObject({
  format: z.literal(EXPORT_FORMAT),
  ids: z.strictObject({
    projectId: Id,
    uiViewId: Id,
    uiId: UiIdSchema,
    sessionId: Id,
    uiVersionId: Id,
    specRevisionId: Id,
    promptVersionId: Id,
  }),
  uiVersion: z.strictObject({
    id: Id,
    projectId: Id,
    uiViewId: Id,
    versionNo: z.number().int().min(1),
    screenshotId: Id,
    screenshotIds: z.array(Id).min(1).max(IMPORT_LIMITS.maxScreenshots),
    specRevisionId: Id,
    promptVersionId: Id,
    sessionId: Id,
    predecessorVersionId: Id.nullable(),
    pathAtVersion: UiPathSchema,
    changeDescription: Text,
    createdBy: z.string().max(200),
    createdAt: Timestamp,
  }),
  specRevision: z.strictObject({
    id: Id,
    revisionNo: z.number().int().min(1),
    snapshotSha256: Sha256,
    previousSpecRevisionId: Id.nullable(),
    releasedBy: z.string().max(200),
    releasedAt: Timestamp,
  }),
  promptVersion: z.strictObject({
    id: Id,
    generatorVersion: z.string().min(1).max(100),
    sha256: Sha256,
    createdAt: Timestamp,
  }),
  screenshots: z.array(SnapshotScreenshotSchema).max(IMPORT_LIMITS.maxScreenshots),
  specification: z.strictObject({
    format: z.literal(SPECIFICATION_FORMAT),
    generatorVersion: z.string().min(1).max(100),
    references: z.strictObject({
      projectId: Id,
      uiViewId: Id,
      uiId: UiIdSchema,
      uiPath: UiPathSchema,
      uiVersionId: Id,
      versionNo: z.number().int().min(1),
      specRevisionId: Id,
      revisionNo: z.number().int().min(1),
      predecessor: VersionRef.nullable(),
      releasedAt: Timestamp,
      releasedBy: z.string().max(200),
      changeDescription: Text,
      screenshotIds: z.array(Id).max(IMPORT_LIMITS.maxScreenshots),
      primaryScreenshotId: Id,
    }),
    specification: SnapshotSchema,
  }),
});
type ExportDocument = z.output<typeof ExportDocumentSchema>;

const ManifestSchema = z.strictObject({
  format: z.literal(ARCHIVE_FORMAT),
  exportFormat: z.literal(EXPORT_FORMAT),
  uiId: UiIdSchema,
  uiVersionId: Id,
  versionNo: z.number().int().min(1),
  files: z
    .array(
      z.strictObject({
        path: z.string().regex(ARCHIVE_PATH_PATTERN),
        sha256: Sha256,
        bytes: z.number().int().min(0),
      }),
    )
    .max(4 + 2 * IMPORT_LIMITS.maxScreenshots),
});

// ── Validation ────────────────────────────────────────────────────────────────

const invalid = (message: string, details: Record<string, unknown> = {}): OpsisError =>
  new OpsisError('VALIDATION', `Invalid archive: ${message}`, details);

const utf8 = new TextDecoder('utf-8', { fatal: true });

const decodeText = (entry: ArchiveEntry): string => {
  try {
    return utf8.decode(entry.bytes);
  } catch {
    throw invalid('file is not UTF-8', { path: entry.path });
  }
};

const parseJson = <S extends z.ZodType>(schema: S, entry: ArchiveEntry): z.output<S> => {
  let value: unknown;
  try {
    value = JSON.parse(decodeText(entry));
  } catch (error) {
    if (error instanceof OpsisError) throw error;
    throw invalid('file is not valid JSON', { path: entry.path });
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    throw invalid(`${entry.path} does not match its schema`, {
      issues: result.error.issues.slice(0, 20).map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
};

/** References inside the snapshot the generators rely on. */
const checkSnapshot = (snapshot: SpecSnapshot): void => {
  const screenshots = new Set(snapshot.screenshots.map((screenshot) => screenshot.id));
  const components = new Set(snapshot.components.map((component) => component.componentId));
  const problems: string[] = [];
  if (screenshots.size !== snapshot.screenshots.length) problems.push('duplicate screenshot ids');
  if (components.size !== snapshot.components.length) problems.push('duplicate component ids');
  if (!screenshots.has(snapshot.primaryScreenshotId)) problems.push('primary screenshot missing');
  const seenParents = new Set<string>();
  for (const component of snapshot.components) {
    // Tree order: a parent comes before its children.
    if (component.parentId !== null && !seenParents.has(component.parentId)) {
      problems.push(`parent of ${component.componentId} missing or out of order`);
    }
    seenParents.add(component.componentId);
    for (const region of component.regions) {
      if (!screenshots.has(region.screenshotId))
        problems.push(`region of ${component.componentId} on unknown screenshot`);
    }
  }
  for (const relation of snapshot.relations) {
    if (!components.has(relation.fromComponentId) || !components.has(relation.toComponentId)) {
      problems.push(`relation ${relation.id} points to a missing component`);
    }
  }
  if (problems.length > 0) throw invalid('inconsistent specification', { problems: problems.slice(0, 20) });
};

interface ValidatedArchive {
  readonly document: ExportDocument;
  readonly snapshot: SpecSnapshot;
  readonly snapshotJson: string;
  readonly prompt: string;
  readonly images: ReadonlyMap<string, Uint8Array>;
}

const validateArchive = async (
  ctx: AppContext,
  entries: readonly ArchiveEntry[],
): Promise<ValidatedArchive> => {
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const file = (path: string): ArchiveEntry => {
    const entry = byPath.get(path);
    if (!entry) throw invalid('file missing', { path });
    return entry;
  };

  // Manifest: format, and exactly the listed files with matching hash and size.
  const manifest = parseJson(ManifestSchema, file(ARCHIVE_PATHS.manifest));
  const listed = new Set(manifest.files.map((entry) => entry.path));
  if (listed.size !== manifest.files.length || listed.has(ARCHIVE_PATHS.manifest)) {
    throw invalid('manifest lists files twice or itself');
  }
  for (const entry of entries) {
    if (entry.path !== ARCHIVE_PATHS.manifest && !listed.has(entry.path)) {
      throw invalid('file not listed in the manifest', { path: entry.path });
    }
  }
  for (const listedFile of manifest.files) {
    const entry = file(listedFile.path);
    if (
      entry.bytes.byteLength !== listedFile.bytes ||
      ctx.hash.sha256Bytes(entry.bytes) !== listedFile.sha256
    ) {
      throw invalid('hash or size does not match the manifest', { path: listedFile.path });
    }
  }

  // Version document and the snapshot inside it.
  const document = parseJson(ExportDocumentSchema, file(ARCHIVE_PATHS.document));
  // Validated above; the zod output differs only in optional-property typing.
  const snapshot = document.specification.specification as unknown as SpecSnapshot;
  const snapshotJson = canonicalJson(snapshot);
  if (ctx.hash.sha256(snapshotJson) !== document.specRevision.snapshotSha256) {
    throw invalid('specification does not match its hash');
  }
  checkSnapshot(snapshot);
  const { ids, uiVersion, specRevision, promptVersion } = document;
  const consistent =
    manifest.uiVersionId === ids.uiVersionId &&
    manifest.versionNo === uiVersion.versionNo &&
    manifest.uiId === snapshot.uiView.uiId &&
    ids.uiVersionId === uiVersion.id &&
    ids.specRevisionId === specRevision.id &&
    ids.promptVersionId === promptVersion.id &&
    uiVersion.specRevisionId === specRevision.id &&
    uiVersion.promptVersionId === promptVersion.id &&
    uiVersion.screenshotId === snapshot.primaryScreenshotId &&
    canonicalJson(uiVersion.screenshotIds) === canonicalJson(snapshot.screenshots.map((s) => s.id));
  if (!consistent) throw invalid('ids of manifest, version and specification do not match');

  const prompt = decodeText(file(ARCHIVE_PATHS.prompt));
  if (ctx.hash.sha256(prompt) !== promptVersion.sha256) throw invalid('prompt does not match its hash');

  // Screenshots: content hash and a full decode with the regular image checks.
  const images = new Map<string, Uint8Array>();
  for (const screenshot of snapshot.screenshots) {
    const entry = file(ARCHIVE_PATHS.screenshot(screenshot));
    if (ctx.hash.sha256Bytes(entry.bytes) !== screenshot.sha256) {
      throw invalid('screenshot does not match its hash', { path: entry.path });
    }
    const inspected = await ctx.images.inspect(entry.bytes);
    if (
      inspected.mimeType !== screenshot.mimeType ||
      inspected.width !== screenshot.width ||
      inspected.height !== screenshot.height
    ) {
      throw invalid('screenshot does not match its metadata', { path: entry.path });
    }
    images.set(screenshot.id, entry.bytes);
  }
  return { document, snapshot, snapshotJson, prompt, images };
};

// ── Use case ──────────────────────────────────────────────────────────────────

export const ImportInputSchema = z.strictObject({ projectId: Id });

export interface ImportResult {
  readonly uiView: UiView;
  readonly uiViewCreated: boolean;
  readonly uiVersion: UiVersion;
  readonly session: Session;
  /** Original id → new id for every record whose id was already taken (decision E6). */
  readonly idMapping: Readonly<Record<string, string>>;
}

export const importVersionArchive = async (
  ctx: AppContext,
  actor: Actor,
  rawInput: unknown,
  bytes: Uint8Array,
): Promise<ImportResult> => {
  const { projectId } = parseInput(ImportInputSchema, rawInput);
  if (actor.type !== 'human') throw new OpsisError('FORBIDDEN_ACTOR', 'Only a human may import versions');
  ctx.access.assertProjectAccess(actor, projectId);
  if (!ctx.repos.projects.findById(projectId))
    throw new OpsisError('NOT_FOUND', `Project "${projectId}" not found`);
  if (bytes.byteLength > IMPORT_LIMITS.maxArchiveBytes) {
    throw new OpsisError('PAYLOAD_TOO_LARGE', 'Archive too large', { max: IMPORT_LIMITS.maxArchiveBytes });
  }

  const entries = await ctx.archives.unpack(bytes, {
    maxEntries: 4 + 2 * IMPORT_LIMITS.maxScreenshots,
    maxEntryBytes: IMPORT_LIMITS.maxEntryBytes,
    maxTotalBytes: IMPORT_LIMITS.maxTotalBytes,
    isAllowedPath: (path) => ARCHIVE_PATH_PATTERN.test(path),
  });
  const archive = await validateArchive(ctx, entries);
  const { document } = archive;

  // Blobs are content-addressed: writing them before the transaction is harmless.
  const blobs = new Map<string, BlobRecord>();
  for (const screenshot of archive.snapshot.screenshots) {
    const image = archive.images.get(screenshot.id);
    if (image) blobs.set(screenshot.sha256, await ctx.blobs.put(image, screenshot.mimeType));
  }

  return commit(ctx, actor, (uow) => {
    // Decision E6: keep ids where free, otherwise assign new ones. A screenshot with the same
    // id, project and content is the same screenshot and is reused.
    const idMapping: Record<string, string> = {};
    const keepOrNew = (id: string, kind: IdKind, taken: boolean): string => {
      if (!taken) return id;
      const fresh = newId(kind);
      idMapping[id] = fresh;
      return fresh;
    };
    const reused = new Set<string>();
    for (const screenshot of archive.snapshot.screenshots) {
      const existing = ctx.repos.screenshots.findById(screenshot.id);
      if (existing?.projectId === projectId && existing.blobSha256 === screenshot.sha256)
        reused.add(screenshot.id);
      else keepOrNew(screenshot.id, 'screenshot', existing !== undefined);
    }
    const specRevisionId = keepOrNew(
      document.specRevision.id,
      'specRevision',
      ctx.repos.versions.findSpecRevision(document.specRevision.id) !== undefined,
    );
    const promptVersionId = keepOrNew(
      document.promptVersion.id,
      'promptVersion',
      ctx.repos.versions.findPromptVersion(document.promptVersion.id) !== undefined,
    );
    const uiVersionId = keepOrNew(
      document.uiVersion.id,
      'uiVersion',
      ctx.repos.versions.findUiVersion(document.uiVersion.id) !== undefined,
    );
    // Ids are unique tokens, so new ids are written into snapshot and prompt by replacement.
    const remap = (text: string): string => text.replace(ID_TOKEN, (id) => idMapping[id] ?? id);
    const snapshot = JSON.parse(remap(archive.snapshotJson)) as SpecSnapshot;
    const snapshotJson = canonicalJson(snapshot);
    const prompt = remap(archive.prompt);

    // UI view: the existing one with this UI-ID, otherwise a new one.
    let uiView = ctx.repos.uiViews.findByUiId(projectId, snapshot.uiView.uiId);
    const uiViewCreated = uiView === undefined;
    uiView ??= insertUiView(ctx, actor, uow, {
      projectId,
      uiId: snapshot.uiView.uiId,
      path: snapshot.uiView.path,
      name: snapshot.uiView.name,
      description: snapshot.uiView.description,
    });
    const head =
      uiView.headVersionId === null ? undefined : ctx.repos.versions.findUiVersion(uiView.headVersionId);
    const versionNo = ctx.repos.versions.nextVersionNo(uiView.id);

    // A session that represents the import; it is ready for delivery like a release.
    let session: Session = {
      id: newId('session'),
      projectId,
      uiViewId: uiView.id,
      agentId: null,
      agentSessionRef: null,
      intent: head ? 'revise' : 'create',
      title: `Import: ${snapshot.uiView.name} V${String(document.uiVersion.versionNo)}`.slice(0, 200),
      status: 'ready',
      assignment: 'confirmed',
      proposedPath: null,
      assignmentNote: null,
      baseVersionId: head?.id ?? null,
      rebasedFromVersionId: null,
      resultVersionId: null,
      statusReason: null,
      rowVersion: 1,
      createdAt: uow.now,
      updatedAt: uow.now,
    };
    ctx.repos.sessions.insert(session);
    recordStatusEvent(ctx, actor, uow, session.id, null, 'ready', `imported as V${String(versionNo)}`);

    for (const screenshot of snapshot.screenshots) {
      if (reused.has(screenshot.id)) continue;
      const blob = blobs.get(screenshot.sha256);
      if (!blob) throw new OpsisError('VALIDATION', 'Screenshot content missing');
      ctx.repos.screenshots.insertBlobIfMissing(blob, uow.now);
      const row: Screenshot = {
        id: screenshot.id,
        projectId,
        uiViewId: uiView.id,
        sessionId: session.id,
        blobSha256: screenshot.sha256,
        mimeType: screenshot.mimeType,
        width: screenshot.width,
        height: screenshot.height,
        viewportWidth: screenshot.viewportWidth,
        viewportHeight: screenshot.viewportHeight,
        deviceCategory: screenshot.deviceCategory,
        variantLabel: screenshot.variantLabel,
        sequenceNo: ctx.repos.screenshots.nextSequenceNo(uiView.id),
        capturedAt: screenshot.capturedAt,
        source: 'import',
        submittedBy: actorRef(actor),
        description: screenshot.description,
        createdAt: uow.now,
      };
      ctx.repos.screenshots.insert(row);
    }

    // History records, as in a release (05 §2 steps 4–8), with the imported content.
    const revisionIds = storeComponentRevisions(ctx, snapshot, uow.now);
    const specRevision: SpecRevision = {
      id: specRevisionId,
      projectId,
      uiViewId: uiView.id,
      sessionId: session.id,
      revisionNo: ctx.repos.versions.nextRevisionNo(uiView.id),
      snapshot: snapshotJson,
      snapshotSha256: ctx.hash.sha256(snapshotJson),
      completeness: snapshot.completeness,
      acknowledgedIssues: snapshot.acknowledgedWarnings,
      previousSpecRevisionId: head?.specRevisionId ?? null,
      releasedBy: document.specRevision.releasedBy,
      releasedAt: document.specRevision.releasedAt,
    };
    ctx.repos.versions.insertSpecRevision(specRevision);
    storeComponentTree(ctx, specRevision.id, snapshot, revisionIds);

    const promptVersion: PromptVersion = {
      id: promptVersionId,
      specRevisionId: specRevision.id,
      generatorVersion: document.promptVersion.generatorVersion,
      markdown: prompt,
      sha256: ctx.hash.sha256(prompt),
      createdAt: uow.now,
    };
    ctx.repos.versions.insertPromptVersion(promptVersion);

    const uiVersion: UiVersion = {
      id: uiVersionId,
      projectId,
      uiViewId: uiView.id,
      versionNo,
      screenshotId: snapshot.primaryScreenshotId,
      screenshotIds: snapshot.screenshots.map((screenshot) => screenshot.id),
      specRevisionId: specRevision.id,
      promptVersionId: promptVersion.id,
      sessionId: session.id,
      predecessorVersionId: head?.id ?? null,
      pathAtVersion: document.uiVersion.pathAtVersion,
      changeDescription: document.uiVersion.changeDescription,
      createdBy: actorRef(actor),
      createdAt: uow.now,
    };
    ctx.repos.versions.insertUiVersion(uiVersion);

    const updatedView: UiView = { ...uiView, headVersionId: uiVersion.id, updatedAt: uow.now };
    ctx.repos.uiViews.update(updatedView);
    const withResult: Session = {
      ...session,
      resultVersionId: uiVersion.id,
      rowVersion: 2,
      updatedAt: uow.now,
    };
    ctx.repos.sessions.update(withResult, session.rowVersion);
    session = withResult;

    uow.audit({
      projectId,
      entityType: 'ui_version',
      entityId: uiVersion.id,
      action: 'import',
      data: {
        sessionId: session.id,
        versionNo,
        original: {
          uiVersionId: document.uiVersion.id,
          versionNo: document.uiVersion.versionNo,
          projectId: document.ids.projectId,
          snapshotSha256: document.specRevision.snapshotSha256,
          promptSha256: document.promptVersion.sha256,
        },
        idMapping,
        uiViewCreated,
      },
    });
    uow.emit({ type: 'SessionStatusChanged', projectId, sessionId: session.id, from: null, to: 'ready' });
    uow.emit({
      type: 'UiVersionCreated',
      projectId,
      uiViewId: uiView.id,
      sessionId: session.id,
      versionId: uiVersion.id,
      versionNo,
    });
    uow.emit({ type: 'UiViewChanged', projectId, uiViewId: uiView.id });
    return { uiView: updatedView, uiViewCreated, uiVersion, session, idMapping };
  });
};
