import {
  COMPONENT_KINDS,
  DEVICE_CATEGORIES,
  RELATION_KINDS,
  IMAGE_MIME_TYPES,
  OpsisError,
  PROMPT_LANGUAGES,
  SCREENSHOT_SOURCES,
  SESSION_ASSIGNMENTS,
  SESSION_INTENTS,
  SESSION_STATUSES,
  type AgentGrantRepository,
  type AuditEntry,
  type AuditLog,
  type BlobRecord,
  type ComponentSpec,
  type Draft,
  type DraftComponent,
  type DraftRepository,
  type Region,
  type Relation,
  type Metadata,
  type Project,
  type ProjectRepository,
  type Repositories,
  type Screenshot,
  type ScreenshotRepository,
  type Session,
  type SessionRepository,
  type SessionStatus,
  type SessionStatusEvent,
  type UiPathChange,
  type UiView,
  type UiViewRepository,
} from '@opsis/core';
import type { Database, Params } from './database.js';
import { json, num, oneOf, optNum, optStr, str } from './rows.js';

type Row = Record<string, unknown>;

/** Builds `IN (:p0, :p1, …)` with bound parameters – never string-concatenated values. */
const inList = (prefix: string, values: readonly string[]): { sql: string; params: Params } => {
  const params: Params = {};
  const names = values.map((value, index) => {
    params[`${prefix}${index}`] = value;
    return `:${prefix}${index}`;
  });
  return { sql: `(${names.join(', ')})`, params };
};

// ── Projects ────────────────────────────────────────────────────────────────
const toProject = (row: Row): Project => ({
  id: str(row, 'id'),
  slug: str(row, 'slug'),
  name: str(row, 'name'),
  description: str(row, 'description'),
  promptLanguage: oneOf(row, 'prompt_language', PROMPT_LANGUAGES),
  metadata: json(row, 'metadata') as Metadata,
  createdAt: str(row, 'created_at'),
  updatedAt: str(row, 'updated_at'),
  archivedAt: optStr(row, 'archived_at'),
});

class SqliteProjectRepository implements ProjectRepository {
  constructor(private readonly db: Database) {}

  insert(p: Project): void {
    this.db.execute(
      `INSERT INTO projects (id, slug, name, description, prompt_language, metadata, created_at, updated_at, archived_at)
       VALUES (:id, :slug, :name, :description, :lang, :metadata, :createdAt, :updatedAt, :archivedAt)`,
      {
        id: p.id,
        slug: p.slug,
        name: p.name,
        description: p.description,
        lang: p.promptLanguage,
        metadata: JSON.stringify(p.metadata),
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        archivedAt: p.archivedAt,
      },
    );
  }

  update(p: Project): void {
    this.db.execute(
      `UPDATE projects SET name = :name, description = :description, prompt_language = :lang, metadata = :metadata,
         updated_at = :updatedAt, archived_at = :archivedAt WHERE id = :id`,
      {
        id: p.id,
        name: p.name,
        description: p.description,
        lang: p.promptLanguage,
        metadata: JSON.stringify(p.metadata),
        updatedAt: p.updatedAt,
        archivedAt: p.archivedAt,
      },
    );
  }

  findById(id: string): Project | undefined {
    const row = this.db.get('SELECT * FROM projects WHERE id = :id', { id });
    return row && toProject(row);
  }

  findBySlug(slug: string): Project | undefined {
    const row = this.db.get('SELECT * FROM projects WHERE slug = :slug', { slug });
    return row && toProject(row);
  }

  list(ids?: readonly string[]): Project[] {
    if (ids === undefined) return this.db.all('SELECT * FROM projects ORDER BY name, id').map(toProject);
    if (ids.length === 0) return [];
    const { sql, params } = inList('id', ids);
    return this.db.all(`SELECT * FROM projects WHERE id IN ${sql} ORDER BY name, id`, params).map(toProject);
  }
}

// ── UI views ────────────────────────────────────────────────────────────────
const toUiView = (row: Row): UiView => ({
  id: str(row, 'id'),
  projectId: str(row, 'project_id'),
  uiId: str(row, 'ui_id'),
  path: str(row, 'path'),
  name: str(row, 'name'),
  description: str(row, 'description'),
  headVersionId: optStr(row, 'head_version_id'),
  createdAt: str(row, 'created_at'),
  updatedAt: str(row, 'updated_at'),
});

const toPathChange = (row: Row): UiPathChange => ({
  id: str(row, 'id'),
  uiViewId: str(row, 'ui_view_id'),
  oldPath: optStr(row, 'old_path'),
  newPath: str(row, 'new_path'),
  changedBy: str(row, 'changed_by'),
  reason: str(row, 'reason'),
  changedAt: str(row, 'changed_at'),
});

class SqliteUiViewRepository implements UiViewRepository {
  constructor(private readonly db: Database) {}

  insert(v: UiView): void {
    this.db.execute(
      `INSERT INTO ui_views (id, project_id, ui_id, path, name, description, head_version_id, created_at, updated_at)
       VALUES (:id, :projectId, :uiId, :path, :name, :description, :head, :createdAt, :updatedAt)`,
      {
        id: v.id,
        projectId: v.projectId,
        uiId: v.uiId,
        path: v.path,
        name: v.name,
        description: v.description,
        head: v.headVersionId,
        createdAt: v.createdAt,
        updatedAt: v.updatedAt,
      },
    );
  }

  /** ui_id and project_id are deliberately not updatable (also enforced by a trigger). */
  update(v: UiView): void {
    this.db.execute(
      `UPDATE ui_views SET path = :path, name = :name, description = :description, head_version_id = :head,
         updated_at = :updatedAt WHERE id = :id`,
      {
        id: v.id,
        path: v.path,
        name: v.name,
        description: v.description,
        head: v.headVersionId,
        updatedAt: v.updatedAt,
      },
    );
  }

  findById(id: string): UiView | undefined {
    const row = this.db.get('SELECT * FROM ui_views WHERE id = :id', { id });
    return row && toUiView(row);
  }

  findByUiId(projectId: string, uiId: string): UiView | undefined {
    const row = this.db.get('SELECT * FROM ui_views WHERE project_id = :projectId AND ui_id = :uiId', {
      projectId,
      uiId,
    });
    return row && toUiView(row);
  }

  findByPath(projectId: string, path: string): UiView | undefined {
    const row = this.db.get('SELECT * FROM ui_views WHERE project_id = :projectId AND path = :path', {
      projectId,
      path,
    });
    return row && toUiView(row);
  }

  listByProject(projectId: string): UiView[] {
    return this.db
      .all('SELECT * FROM ui_views WHERE project_id = :projectId ORDER BY path', { projectId })
      .map(toUiView);
  }

  insertPathChange(c: UiPathChange): void {
    this.db.execute(
      `INSERT INTO ui_path_changes (id, ui_view_id, old_path, new_path, changed_by, reason, changed_at)
       VALUES (:id, :uiViewId, :oldPath, :newPath, :changedBy, :reason, :changedAt)`,
      { ...c },
    );
  }

  listPathChanges(uiViewId: string): UiPathChange[] {
    return this.db
      .all('SELECT * FROM ui_path_changes WHERE ui_view_id = :uiViewId ORDER BY changed_at, rowid', {
        uiViewId,
      })
      .map(toPathChange);
  }
}

// ── Screenshots ─────────────────────────────────────────────────────────────
const toScreenshot = (row: Row): Screenshot => ({
  id: str(row, 'id'),
  projectId: str(row, 'project_id'),
  uiViewId: str(row, 'ui_view_id'),
  sessionId: optStr(row, 'session_id'),
  blobSha256: str(row, 'blob_sha256'),
  mimeType: oneOf(row, 'mime_type', IMAGE_MIME_TYPES),
  width: num(row, 'width'),
  height: num(row, 'height'),
  viewportWidth: optNum(row, 'viewport_width'),
  viewportHeight: optNum(row, 'viewport_height'),
  deviceCategory: oneOf(row, 'device_category', DEVICE_CATEGORIES),
  variantLabel: optStr(row, 'variant_label'),
  sequenceNo: num(row, 'sequence_no'),
  capturedAt: optStr(row, 'captured_at'),
  source: oneOf(row, 'source', SCREENSHOT_SOURCES),
  submittedBy: str(row, 'submitted_by'),
  description: str(row, 'description'),
  createdAt: str(row, 'created_at'),
});

const SCREENSHOT_SELECT =
  'SELECT s.*, b.mime_type FROM screenshots s JOIN blobs b ON b.sha256 = s.blob_sha256';

class SqliteScreenshotRepository implements ScreenshotRepository {
  constructor(private readonly db: Database) {}

  insertBlobIfMissing(blob: BlobRecord, createdAt: string): void {
    this.db.execute(
      `INSERT INTO blobs (sha256, mime_type, byte_size, created_at) VALUES (:sha, :mime, :size, :at)
       ON CONFLICT (sha256) DO NOTHING`,
      { sha: blob.sha256, mime: blob.mimeType, size: blob.byteSize, at: createdAt },
    );
  }

  insert(s: Screenshot): void {
    this.db.execute(
      `INSERT INTO screenshots (id, project_id, ui_view_id, session_id, blob_sha256, width, height, viewport_width,
         viewport_height, device_category, variant_label, sequence_no, captured_at, source, submitted_by, description, created_at)
       VALUES (:id, :projectId, :uiViewId, :sessionId, :sha, :width, :height, :vw, :vh, :device, :variant, :seq,
         :capturedAt, :source, :submittedBy, :description, :createdAt)`,
      {
        id: s.id,
        projectId: s.projectId,
        uiViewId: s.uiViewId,
        sessionId: s.sessionId,
        sha: s.blobSha256,
        width: s.width,
        height: s.height,
        vw: s.viewportWidth,
        vh: s.viewportHeight,
        device: s.deviceCategory,
        variant: s.variantLabel,
        seq: s.sequenceNo,
        capturedAt: s.capturedAt,
        source: s.source,
        submittedBy: s.submittedBy,
        description: s.description,
        createdAt: s.createdAt,
      },
    );
  }

  findById(id: string): Screenshot | undefined {
    const row = this.db.get(`${SCREENSHOT_SELECT} WHERE s.id = :id`, { id });
    return row && toScreenshot(row);
  }

  list(filter: { projectId: string; uiViewId?: string; sessionId?: string }): Screenshot[] {
    const where = ['s.project_id = :projectId'];
    const params: Params = { projectId: filter.projectId };
    if (filter.uiViewId !== undefined) {
      where.push('s.ui_view_id = :uiViewId');
      params['uiViewId'] = filter.uiViewId;
    }
    if (filter.sessionId !== undefined) {
      where.push('s.session_id = :sessionId');
      params['sessionId'] = filter.sessionId;
    }
    return this.db
      .all(`${SCREENSHOT_SELECT} WHERE ${where.join(' AND ')} ORDER BY s.created_at, s.id`, params)
      .map(toScreenshot);
  }

  nextSequenceNo(uiViewId: string): number {
    const row = this.db.get(
      'SELECT COALESCE(MAX(sequence_no), 0) + 1 AS n FROM screenshots WHERE ui_view_id = :uiViewId',
      {
        uiViewId,
      },
    );
    return row ? num(row, 'n') : 1;
  }
}

// ── Sessions ────────────────────────────────────────────────────────────────
const toSession = (row: Row): Session => ({
  id: str(row, 'id'),
  projectId: str(row, 'project_id'),
  uiViewId: str(row, 'ui_view_id'),
  agentId: optStr(row, 'agent_id'),
  agentSessionRef: optStr(row, 'agent_session_ref'),
  intent: oneOf(row, 'intent', SESSION_INTENTS),
  title: str(row, 'title'),
  status: oneOf(row, 'status', SESSION_STATUSES),
  assignment: oneOf(row, 'assignment', SESSION_ASSIGNMENTS),
  proposedPath: optStr(row, 'proposed_path'),
  assignmentNote: optStr(row, 'assignment_note'),
  baseVersionId: optStr(row, 'base_version_id'),
  resultVersionId: optStr(row, 'result_version_id'),
  statusReason: optStr(row, 'status_reason'),
  rowVersion: num(row, 'row_version'),
  createdAt: str(row, 'created_at'),
  updatedAt: str(row, 'updated_at'),
});

const sessionParams = (s: Session): Params => ({
  id: s.id,
  projectId: s.projectId,
  uiViewId: s.uiViewId,
  agentId: s.agentId,
  agentSessionRef: s.agentSessionRef,
  intent: s.intent,
  title: s.title,
  status: s.status,
  assignment: s.assignment,
  proposedPath: s.proposedPath,
  assignmentNote: s.assignmentNote,
  baseVersionId: s.baseVersionId,
  resultVersionId: s.resultVersionId,
  statusReason: s.statusReason,
  rowVersion: s.rowVersion,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

const toStatusEvent = (row: Row): SessionStatusEvent => ({
  id: str(row, 'id'),
  sessionId: str(row, 'session_id'),
  fromStatus: row['from_status'] === null ? null : oneOf(row, 'from_status', SESSION_STATUSES),
  toStatus: oneOf(row, 'to_status', SESSION_STATUSES),
  actor: str(row, 'actor'),
  note: optStr(row, 'note'),
  at: str(row, 'at'),
});

class SqliteSessionRepository implements SessionRepository {
  constructor(private readonly db: Database) {}

  insert(s: Session): void {
    this.db.execute(
      `INSERT INTO sessions (id, project_id, ui_view_id, agent_id, agent_session_ref, intent, title, status, assignment,
         proposed_path, assignment_note, base_version_id, result_version_id, status_reason, row_version, created_at, updated_at)
       VALUES (:id, :projectId, :uiViewId, :agentId, :agentSessionRef, :intent, :title, :status, :assignment,
         :proposedPath, :assignmentNote, :baseVersionId, :resultVersionId, :statusReason, :rowVersion, :createdAt, :updatedAt)`,
      sessionParams(s),
    );
  }

  update(s: Session, expectedRowVersion: number): void {
    const changes = this.db.execute(
      `UPDATE sessions SET status = :status, title = :title, assignment = :assignment, proposed_path = :proposedPath,
         assignment_note = :assignmentNote, base_version_id = :baseVersionId, result_version_id = :resultVersionId,
         status_reason = :statusReason, row_version = :rowVersion, updated_at = :updatedAt
       WHERE id = :id AND row_version = :expected`,
      {
        id: s.id,
        status: s.status,
        title: s.title,
        assignment: s.assignment,
        proposedPath: s.proposedPath,
        assignmentNote: s.assignmentNote,
        baseVersionId: s.baseVersionId,
        resultVersionId: s.resultVersionId,
        statusReason: s.statusReason,
        rowVersion: s.rowVersion,
        updatedAt: s.updatedAt,
        expected: expectedRowVersion,
      },
    );
    if (changes !== 1) {
      throw new OpsisError(
        'VERSION_CONFLICT',
        `Session "${s.id}" was modified concurrently; reload and retry`,
        {
          sessionId: s.id,
        },
      );
    }
  }

  findById(id: string): Session | undefined {
    const row = this.db.get('SELECT * FROM sessions WHERE id = :id', { id });
    return row && toSession(row);
  }

  list(filter: { projectId: string; uiViewId?: string; statuses?: readonly SessionStatus[] }): Session[] {
    const where = ['project_id = :projectId'];
    let params: Params = { projectId: filter.projectId };
    if (filter.uiViewId !== undefined) {
      where.push('ui_view_id = :uiViewId');
      params['uiViewId'] = filter.uiViewId;
    }
    if (filter.statuses !== undefined) {
      if (filter.statuses.length === 0) return [];
      const list = inList('st', filter.statuses);
      where.push(`status IN ${list.sql}`);
      params = { ...params, ...list.params };
    }
    return this.db
      .all(`SELECT * FROM sessions WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC`, params)
      .map(toSession);
  }

  insertStatusEvent(e: SessionStatusEvent): void {
    this.db.execute(
      `INSERT INTO session_status_events (id, session_id, from_status, to_status, actor, note, at)
       VALUES (:id, :sessionId, :fromStatus, :toStatus, :actor, :note, :at)`,
      { ...e },
    );
  }

  listStatusEvents(sessionId: string): SessionStatusEvent[] {
    return this.db
      .all('SELECT * FROM session_status_events WHERE session_id = :sessionId ORDER BY at, rowid', {
        sessionId,
      })
      .map(toStatusEvent);
  }

  createEmptyDraft(sessionId: string, at: string): void {
    this.db.execute('INSERT INTO drafts (session_id, updated_at) VALUES (:sessionId, :at)', {
      sessionId,
      at,
    });
  }
}

// ── Grants & audit ──────────────────────────────────────────────────────────
class SqliteGrantRepository implements AgentGrantRepository {
  constructor(private readonly db: Database) {}

  listProjectIds(agentId: string): string[] {
    return this.db
      .all('SELECT project_id FROM agent_grants WHERE agent_id = :agentId ORDER BY project_id', { agentId })
      .map((row) => str(row, 'project_id'));
  }

  hasGrant(agentId: string, projectId: string): boolean {
    return (
      this.db.get('SELECT 1 AS ok FROM agent_grants WHERE agent_id = :agentId AND project_id = :projectId', {
        agentId,
        projectId,
      }) !== undefined
    );
  }

  grant(agentId: string, projectId: string, at: string): void {
    this.db.execute(
      `INSERT INTO agent_grants (agent_id, project_id, role, granted_at) VALUES (:agentId, :projectId, 'contributor', :at)
       ON CONFLICT (agent_id, project_id) DO NOTHING`,
      { agentId, projectId, at },
    );
  }
}

class SqliteAuditLog implements AuditLog {
  constructor(private readonly db: Database) {}

  append(e: AuditEntry): void {
    this.db.execute(
      `INSERT INTO audit_log (id, at, actor_type, actor_id, project_id, entity_type, entity_id, action, data)
       VALUES (:id, :at, :actorType, :actorId, :projectId, :entityType, :entityId, :action, :data)`,
      {
        id: e.id,
        at: e.at,
        actorType: e.actor.type,
        actorId: e.actor.id,
        projectId: e.projectId,
        entityType: e.entityType,
        entityId: e.entityId,
        action: e.action,
        data: JSON.stringify(e.data),
      },
    );
  }
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const stringList = (row: Row, column: string): string[] => {
  const value = json(row, column);
  if (!isStringArray(value)) throw new Error(`Column "${column}" is not a string list`);
  return value;
};

const specOf = (row: Row): ComponentSpec => {
  const value = json(row, 'spec');
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Column "spec" is not an object');
  }
  // Written only by this repository from validated drafts.
  return value;
};

class SqliteDraftRepository implements DraftRepository {
  constructor(private readonly db: Database) {}

  find(sessionId: string): Draft | undefined {
    const row = this.db.get('SELECT * FROM drafts WHERE session_id = :sessionId', { sessionId });
    if (!row) return undefined;

    const regions = new Map<string, Region[]>();
    for (const region of this.db.all(
      'SELECT * FROM draft_regions WHERE session_id = :sessionId ORDER BY component_id, screenshot_id',
      { sessionId },
    )) {
      const list = regions.get(str(region, 'component_id')) ?? [];
      list.push({
        screenshotId: str(region, 'screenshot_id'),
        x: num(region, 'x'),
        y: num(region, 'y'),
        width: num(region, 'width'),
        height: num(region, 'height'),
      });
      regions.set(str(region, 'component_id'), list);
    }

    const rows = this.db.all('SELECT * FROM draft_components WHERE session_id = :sessionId', { sessionId });
    const byParent = new Map<string | null, Row[]>();
    for (const component of rows) {
      const parentId = optStr(component, 'parent_id');
      byParent.set(parentId, [...(byParent.get(parentId) ?? []), component]);
    }
    // Tree order: parents before children, siblings by sort_order (same as the domain).
    const components: DraftComponent[] = [];
    const visit = (parentId: string | null): void => {
      const children = (byParent.get(parentId) ?? []).sort(
        (a, b) => num(a, 'sort_order') - num(b, 'sort_order'),
      );
      for (const component of children) {
        const componentId = str(component, 'component_id');
        components.push({
          componentId,
          parentId,
          order: num(component, 'sort_order'),
          name: str(component, 'name'),
          kind: oneOf(component, 'kind', COMPONENT_KINDS),
          hidden: num(component, 'hidden') === 1,
          spec: specOf(component),
          regions: regions.get(componentId) ?? [],
        });
        visit(componentId);
      }
    };
    visit(null);

    const relations: Relation[] = this.db
      .all('SELECT * FROM draft_relations WHERE session_id = :sessionId ORDER BY id', { sessionId })
      .map((relation) => ({
        id: str(relation, 'id'),
        fromComponentId: str(relation, 'from_component_id'),
        toComponentId: str(relation, 'to_component_id'),
        kind: oneOf(relation, 'kind', RELATION_KINDS),
        description: str(relation, 'description'),
      }));

    return {
      sessionId,
      revision: num(row, 'revision'),
      goal: str(row, 'goal'),
      changeSummary: str(row, 'change_summary'),
      acceptance: stringList(row, 'acceptance'),
      openQuestions: stringList(row, 'open_questions'),
      components,
      relations,
      updatedAt: str(row, 'updated_at'),
    };
  }

  save(draft: Draft): void {
    const sessionId = draft.sessionId;
    this.db.execute(
      `INSERT INTO drafts (session_id, goal, change_summary, acceptance, open_questions, revision, updated_at)
       VALUES (:sessionId, :goal, :changeSummary, :acceptance, :openQuestions, :revision, :updatedAt)
       ON CONFLICT (session_id) DO UPDATE SET
         goal = excluded.goal, change_summary = excluded.change_summary,
         acceptance = excluded.acceptance, open_questions = excluded.open_questions,
         revision = excluded.revision, updated_at = excluded.updated_at`,
      {
        sessionId,
        goal: draft.goal,
        changeSummary: draft.changeSummary,
        acceptance: JSON.stringify(draft.acceptance),
        openQuestions: JSON.stringify(draft.openQuestions),
        revision: draft.revision,
        updatedAt: draft.updatedAt,
      },
    );
    // Replace the children. Components are inserted in tree order, so every parent exists
    // before its children (self-referencing foreign key).
    this.db.execute('DELETE FROM draft_relations WHERE session_id = :sessionId', { sessionId });
    this.db.execute('DELETE FROM draft_regions WHERE session_id = :sessionId', { sessionId });
    this.db.execute('DELETE FROM draft_components WHERE session_id = :sessionId', { sessionId });
    for (const component of draft.components) {
      this.db.execute(
        `INSERT INTO draft_components (session_id, component_id, parent_id, sort_order, name, kind, hidden, spec, updated_at)
         VALUES (:sessionId, :componentId, :parentId, :order, :name, :kind, :hidden, :spec, :updatedAt)`,
        {
          sessionId,
          componentId: component.componentId,
          parentId: component.parentId,
          order: component.order,
          name: component.name,
          kind: component.kind,
          hidden: component.hidden ? 1 : 0,
          spec: JSON.stringify(component.spec),
          updatedAt: draft.updatedAt,
        },
      );
      for (const region of component.regions) {
        this.db.execute(
          `INSERT INTO draft_regions (session_id, component_id, screenshot_id, x, y, width, height)
           VALUES (:sessionId, :componentId, :screenshotId, :x, :y, :width, :height)`,
          { sessionId, componentId: component.componentId, ...region },
        );
      }
    }
    for (const relation of draft.relations) {
      this.db.execute(
        `INSERT INTO draft_relations (id, session_id, from_component_id, to_component_id, kind, description)
         VALUES (:id, :sessionId, :fromComponentId, :toComponentId, :kind, :description)`,
        { sessionId, ...relation },
      );
    }
  }
}

export const createRepositories = (db: Database): Repositories => ({
  projects: new SqliteProjectRepository(db),
  uiViews: new SqliteUiViewRepository(db),
  screenshots: new SqliteScreenshotRepository(db),
  sessions: new SqliteSessionRepository(db),
  drafts: new SqliteDraftRepository(db),
  grants: new SqliteGrantRepository(db),
  audit: new SqliteAuditLog(db),
});
