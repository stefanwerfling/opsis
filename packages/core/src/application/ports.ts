import type { Actor } from '../domain/actor.js';
import type { Agent } from '../domain/agent.js';
import type { Timestamp } from '../domain/common.js';
import type { Draft } from '../domain/draft.js';
import type { DomainEvent } from '../domain/events.js';
import type { Project } from '../domain/project.js';
import type { ImageMimeType, Screenshot } from '../domain/screenshot.js';
import type { Session, SessionStatus } from '../domain/session.js';
import type { Annotation } from '../domain/specification/annotation.js';
import type { UiPathChange, UiView } from '../domain/ui-view.js';
import type {
  ComponentRevision,
  PromptVersion,
  SpecRevision,
  SpecRevisionComponent,
  UiVersion,
} from '../domain/version.js';

/**
 * Ports implemented by the infrastructure layer. They are synchronous on purpose:
 * SQLite transactions must not span an `await` (architecture 01 §4).
 */
export interface ProjectRepository {
  insert(project: Project): void;
  update(project: Project): void;
  findById(id: string): Project | undefined;
  findBySlug(slug: string): Project | undefined;
  /** `ids === undefined` lists all projects; an empty array lists none. */
  list(ids?: readonly string[]): Project[];
}

export interface UiViewRepository {
  insert(view: UiView): void;
  update(view: UiView): void;
  findById(id: string): UiView | undefined;
  findByUiId(projectId: string, uiId: string): UiView | undefined;
  findByPath(projectId: string, path: string): UiView | undefined;
  listByProject(projectId: string): UiView[];
  insertPathChange(change: UiPathChange): void;
  listPathChanges(uiViewId: string): UiPathChange[];
}

export interface BlobRecord {
  readonly sha256: string;
  readonly mimeType: ImageMimeType;
  readonly byteSize: number;
}

export interface ScreenshotRepository {
  insertBlobIfMissing(blob: BlobRecord, createdAt: Timestamp): void;
  insert(screenshot: Screenshot): void;
  findById(id: string): Screenshot | undefined;
  list(filter: { projectId: string; uiViewId?: string; sessionId?: string }): Screenshot[];
  nextSequenceNo(uiViewId: string): number;
}

export interface SessionStatusEvent {
  readonly id: string;
  readonly sessionId: string;
  readonly fromStatus: SessionStatus | null;
  readonly toStatus: SessionStatus;
  readonly actor: string;
  readonly note: string | null;
  readonly at: Timestamp;
}

export interface SessionRepository {
  insert(session: Session): void;
  /** Optimistic locking: throws VERSION_CONFLICT if the stored rowVersion differs from `expectedRowVersion`. */
  update(session: Session, expectedRowVersion: number): void;
  findById(id: string): Session | undefined;
  list(filter: { projectId: string; uiViewId?: string; statuses?: readonly SessionStatus[] }): Session[];
  insertStatusEvent(event: SessionStatusEvent): void;
  listStatusEvents(sessionId: string): SessionStatusEvent[];
  createEmptyDraft(sessionId: string, at: Timestamp): void;
}

export interface DraftRepository {
  find(sessionId: string): Draft | undefined;
  /** Replaces the stored draft (fields, components, regions, relations) of the session. */
  save(draft: Draft): void;
}

export interface ComponentHistoryRow {
  readonly uiVersionId: string;
  readonly componentRevisionId: string;
  readonly parentComponentId: string | null;
  /** Canonical JSON of name, kind, spec and regions. */
  readonly content: string;
}

/** Immutable history: only inserts and reads (architecture 05 §1). */
export interface VersionRepository {
  nextVersionNo(uiViewId: string): number;
  nextRevisionNo(uiViewId: string): number;
  findComponentRevision(componentId: string, contentSha256: string): ComponentRevision | undefined;
  insertComponentRevision(revision: ComponentRevision): void;
  insertSpecRevision(revision: SpecRevision): void;
  insertSpecRevisionComponent(entry: SpecRevisionComponent): void;
  insertPromptVersion(prompt: PromptVersion): void;
  insertUiVersion(version: UiVersion): void;
  findUiVersion(id: string): UiVersion | undefined;
  findUiVersionByNo(uiViewId: string, versionNo: number): UiVersion | undefined;
  listUiVersions(uiViewId: string): UiVersion[];
  findSpecRevision(id: string): SpecRevision | undefined;
  findPromptVersion(id: string): PromptVersion | undefined;
  listSpecRevisionComponents(specRevisionId: string): SpecRevisionComponent[];
  /** Revisions of one component across the versions of a UI view, by version number. */
  listComponentHistory(uiViewId: string, componentId: string): ComponentHistoryRow[];
}

export interface AgentGrantRepository {
  listProjectIds(agentId: string): string[];
  hasGrant(agentId: string, projectId: string): boolean;
  grant(agentId: string, projectId: string, at: Timestamp): void;
  revoke(agentId: string, projectId: string): boolean;
}

export type UploadSlotStatus = 'open' | 'completed' | 'expired';

/** A one-time upload slot of the two-stage upload (06 `opsis_request_upload`). */
export interface UploadSlot {
  readonly id: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly agentId: string | null;
  /** The validated submit input without the image (JSON). */
  readonly request: string;
  readonly status: UploadSlotStatus;
  readonly createdAt: Timestamp;
  readonly expiresAt: Timestamp;
  readonly completedAt: Timestamp | null;
  readonly screenshotId: string | null;
}

export interface UploadSlotRepository {
  insert(slot: UploadSlot, tokenHash: string): void;
  findByTokenHash(tokenHash: string): UploadSlot | undefined;
  /** Open → completed; false if the slot was no longer open (used twice concurrently). */
  complete(id: string, screenshotId: string, at: Timestamp): boolean;
  /** Open slots with `expires_at <= now`. */
  listExpired(now: Timestamp): UploadSlot[];
  expire(id: string): boolean;
}

export interface AgentRepository {
  insert(agent: Agent, tokenHash: string): void;
  findById(id: string): Agent | undefined;
  findByTokenHash(tokenHash: string): Agent | undefined;
  list(): Agent[];
  revoke(id: string, at: Timestamp): void;
}

export interface AuditEntry {
  readonly id: string;
  readonly at: Timestamp;
  readonly actor: Actor;
  readonly projectId: string | null;
  readonly entityType: string;
  readonly entityId: string;
  readonly action: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface AuditLog {
  append(entry: AuditEntry): void;
}

export interface Repositories {
  readonly projects: ProjectRepository;
  readonly uiViews: UiViewRepository;
  readonly screenshots: ScreenshotRepository;
  readonly sessions: SessionRepository;
  readonly drafts: DraftRepository;
  readonly versions: VersionRepository;
  readonly agents: AgentRepository;
  readonly uploads: UploadSlotRepository;
  readonly grants: AgentGrantRepository;
  readonly audit: AuditLog;
}

/** Runs `work` in one database transaction. `work` must be synchronous. */
export interface Transactor {
  run<T>(work: () => T): T;
}

/** SHA-256 as lowercase hex (deterministic content hashes). */
export interface Hasher {
  /** Of UTF-8 text. */
  sha256(text: string): string;
  sha256Bytes(bytes: Uint8Array): string;
}

export interface ArchiveEntry {
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** Limits checked while unpacking, before anything is stored (architecture 05 §7). */
export interface ArchiveLimits {
  readonly maxEntries: number;
  readonly maxEntryBytes: number;
  readonly maxTotalBytes: number;
  /** Only known paths are allowed; everything else rejects the archive. */
  readonly isAllowedPath: (path: string) => boolean;
}

/** ZIP packing/unpacking. `unpack` rejects anything outside the limits with VALIDATION. */
export interface ArchiveCodec {
  pack(entries: readonly ArchiveEntry[]): Promise<Uint8Array>;
  unpack(bytes: Uint8Array, limits: ArchiveLimits): Promise<ArchiveEntry[]>;
}

export interface Clock {
  now(): Timestamp;
}

export interface InspectedImage {
  readonly mimeType: ImageMimeType;
  readonly width: number;
  readonly height: number;
}

/** Validates real image content (magic bytes + full decode), independent of declared MIME types. */
export interface ImageInspector {
  inspect(bytes: Uint8Array): Promise<InspectedImage>;
  /** A reduced WebP copy whose longer edge is at most `maxEdge` (for agents, MCP). */
  thumbnail(bytes: Uint8Array, maxEdge: number): Promise<Uint8Array>;
}

/** Draws the annotation marks onto a screenshot; returns a PNG. */
export interface ImageAnnotator {
  annotate(bytes: Uint8Array, annotation: Annotation): Promise<Uint8Array>;
}

export interface PixelDiffResult {
  /** Size of the mask (a's size, reduced for very large screenshots). */
  readonly width: number;
  readonly height: number;
  readonly differentPixels: number;
  /** b had other dimensions and was scaled to a's size for the comparison. */
  readonly resized: boolean;
  readonly aspectRatioA: number;
  readonly aspectRatioB: number;
  /** PNG: a faded, detected differences highlighted. */
  readonly png: Uint8Array;
}

/** Pixel comparison of two screenshots ("detected pixel differences", architecture 05 §4). */
export interface ImageDiffer {
  diff(a: Uint8Array, b: Uint8Array): Promise<PixelDiffResult>;
}

/** Content-addressed binary storage. Writes are atomic and happen before the DB commit. */
export interface BlobStore {
  put(bytes: Uint8Array, mimeType: ImageMimeType): Promise<BlobRecord>;
  read(sha256: string): Promise<Uint8Array>;
}

export type EventListener = (event: DomainEvent) => void;

export interface EventPublisher {
  publish(event: DomainEvent): void;
  /** Returns an unsubscribe function. */
  subscribe(listener: EventListener): () => void;
}
