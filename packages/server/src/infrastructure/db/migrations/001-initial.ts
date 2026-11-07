/**
 * 001 – initial schema (architecture/03-database-schema.md).
 * Migrations are embedded as strings so the build output needs no extra asset copying.
 */
export const sql = String.raw`
-- ── Stammdaten ──────────────────────────────────────────────────────────────
CREATE TABLE projects (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  prompt_language TEXT NOT NULL DEFAULT 'en' CHECK (prompt_language IN ('en','de')),
  metadata      TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata)),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  archived_at   TEXT
);

CREATE TABLE agents (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,          -- sha256(token), Token selbst nie gespeichert
  created_at  TEXT NOT NULL,
  revoked_at  TEXT
);

CREATE TABLE agent_grants (
  agent_id    TEXT NOT NULL REFERENCES agents(id),
  project_id  TEXT NOT NULL REFERENCES projects(id),
  role        TEXT NOT NULL CHECK (role IN ('contributor')),
  granted_at  TEXT NOT NULL,
  PRIMARY KEY (agent_id, project_id)
);

CREATE TABLE ui_views (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id),
  ui_id            TEXT NOT NULL CHECK (ui_id GLOB 'ui-*'),
  path             TEXT NOT NULL,
  name             TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  head_version_id  TEXT,                     -- FK nach ui_versions (zirkulär, per App geprüft)
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE (project_id, ui_id),
  UNIQUE (project_id, path)
);
CREATE TRIGGER ui_views_ui_id_immutable BEFORE UPDATE OF ui_id, project_id ON ui_views
BEGIN SELECT RAISE(ABORT, 'ui_id is immutable'); END;

CREATE TABLE ui_path_changes (
  id          TEXT PRIMARY KEY,
  ui_view_id  TEXT NOT NULL REFERENCES ui_views(id),
  old_path    TEXT,
  new_path    TEXT NOT NULL,
  changed_by  TEXT NOT NULL,
  reason      TEXT NOT NULL DEFAULT '',
  changed_at  TEXT NOT NULL
);

-- ── Binärdaten / Screenshots ───────────────────────────────────────────────
CREATE TABLE blobs (
  sha256      TEXT PRIMARY KEY,
  mime_type   TEXT NOT NULL CHECK (mime_type IN ('image/png','image/jpeg','image/webp')),
  byte_size   INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE screenshots (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id),
  ui_view_id       TEXT NOT NULL REFERENCES ui_views(id),
  session_id       TEXT REFERENCES sessions(id),
  blob_sha256      TEXT NOT NULL REFERENCES blobs(sha256),
  width            INTEGER NOT NULL CHECK (width > 0),
  height           INTEGER NOT NULL CHECK (height > 0),
  viewport_width   INTEGER,
  viewport_height  INTEGER,
  device_category  TEXT NOT NULL CHECK (device_category IN ('desktop','tablet','mobile','other')),
  variant_label    TEXT,
  sequence_no      INTEGER NOT NULL,
  captured_at      TEXT,
  source           TEXT NOT NULL CHECK (source IN ('mcp','upload','import')),
  submitted_by     TEXT NOT NULL,            -- 'agent:agt_…' | 'human:local'
  description      TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL,
  UNIQUE (ui_view_id, sequence_no)
);

-- ── Sessions & Drafts (veränderlich) ───────────────────────────────────────
CREATE TABLE sessions (
  id                 TEXT PRIMARY KEY,
  project_id         TEXT NOT NULL REFERENCES projects(id),
  ui_view_id         TEXT NOT NULL REFERENCES ui_views(id),
  agent_id           TEXT REFERENCES agents(id),
  agent_session_ref  TEXT,
  intent             TEXT NOT NULL CHECK (intent IN ('create','revise')),
  title              TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL CHECK (status IN
                       ('created','uploading','awaiting_review','in_progress',
                        'ready','delivered','cancelled','failed')),
  assignment         TEXT NOT NULL CHECK (assignment IN ('confirmed','needs_confirmation')),
  proposed_path      TEXT,
  assignment_note    TEXT,
  base_version_id    TEXT REFERENCES ui_versions(id),
  result_version_id  TEXT REFERENCES ui_versions(id),
  status_reason      TEXT,
  row_version        INTEGER NOT NULL DEFAULT 1,   -- optimistische Sperre
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX sessions_by_ui ON sessions(ui_view_id, status);

CREATE TABLE session_status_events (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id),
  from_status TEXT,
  to_status   TEXT NOT NULL,
  actor       TEXT NOT NULL,
  note        TEXT,
  at          TEXT NOT NULL
);

CREATE TABLE drafts (
  session_id         TEXT PRIMARY KEY REFERENCES sessions(id),
  goal               TEXT NOT NULL DEFAULT '',
  change_summary     TEXT NOT NULL DEFAULT '',
  acceptance         TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(acceptance)),
  open_questions     TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(open_questions)),
  conflicts          TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(conflicts)),
  updated_at         TEXT NOT NULL
);

CREATE TABLE draft_components (
  session_id    TEXT NOT NULL REFERENCES sessions(id),
  component_id  TEXT NOT NULL,                 -- stabil über Versionen
  parent_id     TEXT,                          -- component_id im selben Draft
  sort_order    INTEGER NOT NULL,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL,
  hidden        INTEGER NOT NULL DEFAULT 0,
  spec          TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(spec)),
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (session_id, component_id),
  FOREIGN KEY (session_id, parent_id) REFERENCES draft_components(session_id, component_id)
);

CREATE TABLE draft_regions (
  session_id     TEXT NOT NULL,
  component_id   TEXT NOT NULL,
  screenshot_id  TEXT NOT NULL REFERENCES screenshots(id),
  x REAL NOT NULL, y REAL NOT NULL,
  width REAL NOT NULL CHECK (width > 0), height REAL NOT NULL CHECK (height > 0),
  PRIMARY KEY (session_id, component_id, screenshot_id),
  FOREIGN KEY (session_id, component_id)
    REFERENCES draft_components(session_id, component_id) ON DELETE CASCADE
);

CREATE TABLE draft_relations (
  id                 TEXT PRIMARY KEY,
  session_id         TEXT NOT NULL,
  from_component_id  TEXT NOT NULL,
  to_component_id    TEXT NOT NULL,
  kind               TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (session_id, from_component_id) REFERENCES draft_components(session_id, component_id) ON DELETE CASCADE,
  FOREIGN KEY (session_id, to_component_id)   REFERENCES draft_components(session_id, component_id) ON DELETE CASCADE
);

-- ── Unveränderliche History ────────────────────────────────────────────────
CREATE TABLE spec_revisions (
  id                        TEXT PRIMARY KEY,
  project_id                TEXT NOT NULL REFERENCES projects(id),
  ui_view_id                TEXT NOT NULL REFERENCES ui_views(id),
  session_id                TEXT NOT NULL REFERENCES sessions(id),
  revision_no               INTEGER NOT NULL,
  snapshot                  TEXT NOT NULL CHECK (json_valid(snapshot)),
  snapshot_sha256           TEXT NOT NULL,
  completeness              TEXT NOT NULL CHECK (json_valid(completeness)),
  acknowledged_issues       TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(acknowledged_issues)),
  previous_spec_revision_id TEXT REFERENCES spec_revisions(id),
  released_by               TEXT NOT NULL,
  released_at               TEXT NOT NULL,
  UNIQUE (ui_view_id, revision_no)
);

CREATE TABLE component_revisions (
  id              TEXT PRIMARY KEY,
  component_id    TEXT NOT NULL,
  content_sha256  TEXT NOT NULL,
  content         TEXT NOT NULL CHECK (json_valid(content)),  -- name, kind, spec, regions
  created_at      TEXT NOT NULL,
  UNIQUE (component_id, content_sha256)
);

CREATE TABLE spec_revision_components (
  spec_revision_id       TEXT NOT NULL REFERENCES spec_revisions(id),
  component_revision_id  TEXT NOT NULL REFERENCES component_revisions(id),
  component_id           TEXT NOT NULL,
  parent_component_id    TEXT,
  sort_order             INTEGER NOT NULL,
  PRIMARY KEY (spec_revision_id, component_id)
);
CREATE INDEX src_by_component ON spec_revision_components(component_id);

CREATE TABLE prompt_versions (
  id                 TEXT PRIMARY KEY,
  spec_revision_id   TEXT NOT NULL REFERENCES spec_revisions(id),
  generator_version  TEXT NOT NULL,
  markdown           TEXT NOT NULL,
  sha256             TEXT NOT NULL,
  created_at         TEXT NOT NULL
);

CREATE TABLE ui_versions (
  id                      TEXT PRIMARY KEY,
  project_id              TEXT NOT NULL REFERENCES projects(id),
  ui_view_id              TEXT NOT NULL REFERENCES ui_views(id),
  version_no              INTEGER NOT NULL,
  screenshot_id           TEXT NOT NULL REFERENCES screenshots(id),
  screenshot_ids          TEXT NOT NULL CHECK (json_valid(screenshot_ids)),
  spec_revision_id        TEXT NOT NULL UNIQUE REFERENCES spec_revisions(id),
  prompt_version_id       TEXT NOT NULL REFERENCES prompt_versions(id),
  session_id              TEXT NOT NULL REFERENCES sessions(id),
  predecessor_version_id  TEXT REFERENCES ui_versions(id),
  path_at_version         TEXT NOT NULL,
  change_description      TEXT NOT NULL DEFAULT '',
  created_by              TEXT NOT NULL,
  created_at              TEXT NOT NULL,
  UNIQUE (ui_view_id, version_no)
);

-- Unveränderlichkeit technisch erzwingen (Prinzip 6):
CREATE TRIGGER screenshots_no_update         BEFORE UPDATE ON screenshots         BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER screenshots_no_delete         BEFORE DELETE ON screenshots         BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER spec_revisions_no_update      BEFORE UPDATE ON spec_revisions      BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER spec_revisions_no_delete      BEFORE DELETE ON spec_revisions      BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER component_revisions_no_update BEFORE UPDATE ON component_revisions BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER component_revisions_no_delete BEFORE DELETE ON component_revisions BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER src_no_update                 BEFORE UPDATE ON spec_revision_components BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER src_no_delete                 BEFORE DELETE ON spec_revision_components BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER prompt_versions_no_update     BEFORE UPDATE ON prompt_versions     BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER prompt_versions_no_delete     BEFORE DELETE ON prompt_versions     BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER ui_versions_no_update         BEFORE UPDATE ON ui_versions         BEGIN SELECT RAISE(ABORT, 'immutable'); END;
CREATE TRIGGER ui_versions_no_delete         BEFORE DELETE ON ui_versions         BEGIN SELECT RAISE(ABORT, 'immutable'); END;

-- ── Nachvollziehbarkeit ────────────────────────────────────────────────────
CREATE TABLE audit_log (
  id           TEXT PRIMARY KEY,
  at           TEXT NOT NULL,
  actor_type   TEXT NOT NULL CHECK (actor_type IN ('human','agent','system')),
  actor_id     TEXT NOT NULL,
  project_id   TEXT,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  action       TEXT NOT NULL,
  data         TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data))
);
CREATE INDEX audit_by_project ON audit_log(project_id, at);
`;
