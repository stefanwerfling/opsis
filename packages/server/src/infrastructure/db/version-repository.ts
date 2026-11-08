import type {
  ComponentHistoryRow,
  CompletenessReport,
  ComponentRevision,
  PromptVersion,
  SpecRevision,
  SpecRevisionComponent,
  UiVersion,
  VersionRepository,
} from '@opsis/core';
import type { Database } from './database.js';
import { json, num, optStr, str } from './rows.js';

type Row = Record<string, unknown>;

const stringArray = (row: Row, column: string): string[] => {
  const value = json(row, column);
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`Column "${column}" is not a string array`);
  }
  return value;
};

const toUiVersion = (row: Row): UiVersion => ({
  id: str(row, 'id'),
  projectId: str(row, 'project_id'),
  uiViewId: str(row, 'ui_view_id'),
  versionNo: num(row, 'version_no'),
  screenshotId: str(row, 'screenshot_id'),
  screenshotIds: stringArray(row, 'screenshot_ids'),
  specRevisionId: str(row, 'spec_revision_id'),
  promptVersionId: str(row, 'prompt_version_id'),
  sessionId: str(row, 'session_id'),
  predecessorVersionId: optStr(row, 'predecessor_version_id'),
  pathAtVersion: str(row, 'path_at_version'),
  changeDescription: str(row, 'change_description'),
  createdBy: str(row, 'created_by'),
  createdAt: str(row, 'created_at'),
});

const toSpecRevision = (row: Row): SpecRevision => ({
  id: str(row, 'id'),
  projectId: str(row, 'project_id'),
  uiViewId: str(row, 'ui_view_id'),
  sessionId: str(row, 'session_id'),
  revisionNo: num(row, 'revision_no'),
  snapshot: str(row, 'snapshot'),
  snapshotSha256: str(row, 'snapshot_sha256'),
  // Written only by the release use case from a computed report.
  completeness: json(row, 'completeness') as CompletenessReport,
  acknowledgedIssues: stringArray(row, 'acknowledged_issues'),
  previousSpecRevisionId: optStr(row, 'previous_spec_revision_id'),
  releasedBy: str(row, 'released_by'),
  releasedAt: str(row, 'released_at'),
});

const toComponentRevision = (row: Row): ComponentRevision => ({
  id: str(row, 'id'),
  componentId: str(row, 'component_id'),
  contentSha256: str(row, 'content_sha256'),
  content: str(row, 'content'),
  createdAt: str(row, 'created_at'),
});

const toPromptVersion = (row: Row): PromptVersion => ({
  id: str(row, 'id'),
  specRevisionId: str(row, 'spec_revision_id'),
  generatorVersion: str(row, 'generator_version'),
  markdown: str(row, 'markdown'),
  sha256: str(row, 'sha256'),
  createdAt: str(row, 'created_at'),
});

/** Insert-only access to the immutable history tables (UPDATE/DELETE are blocked by triggers). */
export class SqliteVersionRepository implements VersionRepository {
  constructor(private readonly db: Database) {}

  nextVersionNo(uiViewId: string): number {
    const row = this.db.get(
      'SELECT COALESCE(MAX(version_no), 0) + 1 AS n FROM ui_versions WHERE ui_view_id = :uiViewId',
      {
        uiViewId,
      },
    );
    return row ? num(row, 'n') : 1;
  }

  nextRevisionNo(uiViewId: string): number {
    const row = this.db.get(
      'SELECT COALESCE(MAX(revision_no), 0) + 1 AS n FROM spec_revisions WHERE ui_view_id = :uiViewId',
      { uiViewId },
    );
    return row ? num(row, 'n') : 1;
  }

  findComponentRevision(componentId: string, contentSha256: string): ComponentRevision | undefined {
    const row = this.db.get(
      'SELECT * FROM component_revisions WHERE component_id = :componentId AND content_sha256 = :contentSha256',
      { componentId, contentSha256 },
    );
    return row ? toComponentRevision(row) : undefined;
  }

  insertComponentRevision(revision: ComponentRevision): void {
    this.db.execute(
      `INSERT INTO component_revisions (id, component_id, content_sha256, content, created_at)
       VALUES (:id, :componentId, :contentSha256, :content, :createdAt)`,
      { ...revision },
    );
  }

  insertSpecRevision(revision: SpecRevision): void {
    this.db.execute(
      `INSERT INTO spec_revisions (id, project_id, ui_view_id, session_id, revision_no, snapshot, snapshot_sha256,
         completeness, acknowledged_issues, previous_spec_revision_id, released_by, released_at)
       VALUES (:id, :projectId, :uiViewId, :sessionId, :revisionNo, :snapshot, :snapshotSha256,
         :completeness, :acknowledgedIssues, :previousSpecRevisionId, :releasedBy, :releasedAt)`,
      {
        ...revision,
        completeness: JSON.stringify(revision.completeness),
        acknowledgedIssues: JSON.stringify(revision.acknowledgedIssues),
      },
    );
  }

  insertSpecRevisionComponent(entry: SpecRevisionComponent): void {
    this.db.execute(
      `INSERT INTO spec_revision_components (spec_revision_id, component_revision_id, component_id, parent_component_id, sort_order)
       VALUES (:specRevisionId, :componentRevisionId, :componentId, :parentComponentId, :order)`,
      { ...entry },
    );
  }

  insertPromptVersion(prompt: PromptVersion): void {
    this.db.execute(
      `INSERT INTO prompt_versions (id, spec_revision_id, generator_version, markdown, sha256, created_at)
       VALUES (:id, :specRevisionId, :generatorVersion, :markdown, :sha256, :createdAt)`,
      { ...prompt },
    );
  }

  insertUiVersion(version: UiVersion): void {
    this.db.execute(
      `INSERT INTO ui_versions (id, project_id, ui_view_id, version_no, screenshot_id, screenshot_ids, spec_revision_id,
         prompt_version_id, session_id, predecessor_version_id, path_at_version, change_description, created_by, created_at)
       VALUES (:id, :projectId, :uiViewId, :versionNo, :screenshotId, :screenshotIds, :specRevisionId,
         :promptVersionId, :sessionId, :predecessorVersionId, :pathAtVersion, :changeDescription, :createdBy, :createdAt)`,
      { ...version, screenshotIds: JSON.stringify(version.screenshotIds) },
    );
  }

  findUiVersion(id: string): UiVersion | undefined {
    const row = this.db.get('SELECT * FROM ui_versions WHERE id = :id', { id });
    return row ? toUiVersion(row) : undefined;
  }

  findUiVersionByNo(uiViewId: string, versionNo: number): UiVersion | undefined {
    const row = this.db.get(
      'SELECT * FROM ui_versions WHERE ui_view_id = :uiViewId AND version_no = :versionNo',
      {
        uiViewId,
        versionNo,
      },
    );
    return row ? toUiVersion(row) : undefined;
  }

  listUiVersions(uiViewId: string): UiVersion[] {
    return this.db
      .all('SELECT * FROM ui_versions WHERE ui_view_id = :uiViewId ORDER BY version_no', { uiViewId })
      .map(toUiVersion);
  }

  findSpecRevision(id: string): SpecRevision | undefined {
    const row = this.db.get('SELECT * FROM spec_revisions WHERE id = :id', { id });
    return row ? toSpecRevision(row) : undefined;
  }

  findPromptVersion(id: string): PromptVersion | undefined {
    const row = this.db.get('SELECT * FROM prompt_versions WHERE id = :id', { id });
    return row ? toPromptVersion(row) : undefined;
  }

  listComponentHistory(uiViewId: string, componentId: string): ComponentHistoryRow[] {
    return this.db
      .all(
        `SELECT v.id AS ui_version_id, src.component_revision_id, src.parent_component_id, cr.content
           FROM spec_revision_components src
           JOIN ui_versions v ON v.spec_revision_id = src.spec_revision_id
           JOIN component_revisions cr ON cr.id = src.component_revision_id
          WHERE v.ui_view_id = :uiViewId AND src.component_id = :componentId
          ORDER BY v.version_no`,
        { uiViewId, componentId },
      )
      .map((row) => ({
        uiVersionId: str(row, 'ui_version_id'),
        componentRevisionId: str(row, 'component_revision_id'),
        parentComponentId: optStr(row, 'parent_component_id'),
        content: str(row, 'content'),
      }));
  }

  listSpecRevisionComponents(specRevisionId: string): SpecRevisionComponent[] {
    return this.db
      .all('SELECT * FROM spec_revision_components WHERE spec_revision_id = :specRevisionId ORDER BY rowid', {
        specRevisionId,
      })
      .map((row) => ({
        specRevisionId: str(row, 'spec_revision_id'),
        componentRevisionId: str(row, 'component_revision_id'),
        componentId: str(row, 'component_id'),
        parentComponentId: optStr(row, 'parent_component_id'),
        order: num(row, 'sort_order'),
      }));
  }
}
