import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Database } from './database.js';

const T = '2026-11-07T12:00:00.000Z';

/** Inserts one complete, released history chain (project → … → ui_version). */
const seedHistory = (db: Database): void => {
  db.connection.exec(`
    INSERT INTO projects (id, slug, name, created_at, updated_at) VALUES ('prj_1', 'p', 'P', '${T}', '${T}');
    INSERT INTO ui_views (id, project_id, ui_id, path, name, created_at, updated_at)
      VALUES ('uiv_1', 'prj_1', 'ui-dashboard', '/dashboard', 'Dashboard', '${T}', '${T}');
    INSERT INTO blobs (sha256, mime_type, byte_size, created_at) VALUES ('${'a'.repeat(64)}', 'image/png', 10, '${T}');
    INSERT INTO sessions (id, project_id, ui_view_id, intent, status, assignment, created_at, updated_at)
      VALUES ('ses_1', 'prj_1', 'uiv_1', 'create', 'ready', 'confirmed', '${T}', '${T}');
    INSERT INTO screenshots (id, project_id, ui_view_id, session_id, blob_sha256, width, height, device_category,
      sequence_no, source, submitted_by, created_at)
      VALUES ('scr_1', 'prj_1', 'uiv_1', 'ses_1', '${'a'.repeat(64)}', 10, 10, 'desktop', 1, 'upload', 'human:local', '${T}');
    INSERT INTO spec_revisions (id, project_id, ui_view_id, session_id, revision_no, snapshot, snapshot_sha256,
      completeness, released_by, released_at)
      VALUES ('spr_1', 'prj_1', 'uiv_1', 'ses_1', 1, '{}', 'x', '{}', 'human:local', '${T}');
    INSERT INTO component_revisions (id, component_id, content_sha256, content, created_at)
      VALUES ('cmr_1', 'cmp_1', 'h', '{}', '${T}');
    INSERT INTO spec_revision_components (spec_revision_id, component_revision_id, component_id, sort_order)
      VALUES ('spr_1', 'cmr_1', 'cmp_1', 0);
    INSERT INTO prompt_versions (id, spec_revision_id, generator_version, markdown, sha256, created_at)
      VALUES ('prm_1', 'spr_1', '1', '# prompt', 'h', '${T}');
    INSERT INTO ui_versions (id, project_id, ui_view_id, version_no, screenshot_id, screenshot_ids, spec_revision_id,
      prompt_version_id, session_id, path_at_version, created_by, created_at)
      VALUES ('uiver_1', 'prj_1', 'uiv_1', 1, 'scr_1', '["scr_1"]', 'spr_1', 'prm_1', 'ses_1', '/dashboard', 'human:local', '${T}');
  `);
};

describe('Database', () => {
  let db: Database;
  beforeEach(() => {
    db = Database.open(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('applies migrations once and enables foreign keys', () => {
    expect(db.schemaVersion).toBe(4);
    expect(db.get('PRAGMA foreign_keys')?.['foreign_keys']).toBe(1);
    expect(() =>
      db.execute(
        `INSERT INTO ui_views (id, project_id, ui_id, path, name, created_at, updated_at)
         VALUES ('uiv_x', 'missing', 'ui-x', '/x', 'X', '${T}', '${T}')`,
      ),
    ).toThrow(/FOREIGN KEY/);
  });

  describe('immutability of history (principle 6)', () => {
    beforeEach(() => {
      seedHistory(db);
    });

    it.each([
      ["UPDATE ui_versions SET change_description = 'x'", 'ui_versions'],
      ['DELETE FROM ui_versions', 'ui_versions'],
      ['UPDATE spec_revisions SET snapshot = \'{"a":1}\'', 'spec_revisions'],
      ['DELETE FROM spec_revisions', 'spec_revisions'],
      ["UPDATE component_revisions SET content = '{}'", 'component_revisions'],
      ['DELETE FROM component_revisions', 'component_revisions'],
      ['UPDATE spec_revision_components SET sort_order = 5', 'spec_revision_components'],
      ['DELETE FROM spec_revision_components', 'spec_revision_components'],
      ["UPDATE prompt_versions SET markdown = 'changed'", 'prompt_versions'],
      ['DELETE FROM prompt_versions', 'prompt_versions'],
      ["UPDATE screenshots SET description = 'changed'", 'screenshots'],
      ['DELETE FROM screenshots', 'screenshots'],
    ])('rejects "%s"', (statement) => {
      expect(() => db.execute(statement)).toThrow(/immutable/);
    });

    it('keeps the UI-ID immutable while the path may change', () => {
      expect(() => db.execute("UPDATE ui_views SET ui_id = 'ui-other'")).toThrow(/ui_id is immutable/);
      expect(db.execute("UPDATE ui_views SET path = '/home'")).toBe(1);
    });
  });

  describe('transactions', () => {
    const count = () => Number(db.get('SELECT COUNT(*) AS n FROM projects')?.['n']);
    const insert = (id: string) =>
      db.execute(
        `INSERT INTO projects (id, slug, name, created_at, updated_at) VALUES (:id, :id, 'P', '${T}', '${T}')`,
        {
          id,
        },
      );

    it('rolls back everything on error', () => {
      expect(() =>
        db.run(() => {
          insert('a');
          throw new Error('boom');
        }),
      ).toThrow('boom');
      expect(count()).toBe(0);
    });

    it('supports nested transactions via savepoints', () => {
      db.run(() => {
        insert('outer');
        expect(() =>
          db.run(() => {
            insert('inner');
            throw new Error('inner failure');
          }),
        ).toThrow('inner failure');
      });
      expect(db.all('SELECT id FROM projects').map((r) => r['id'])).toEqual(['outer']);
    });

    it('refuses asynchronous work inside a transaction', () => {
      expect(() => db.run(() => Promise.resolve(insert('async')))).toThrow(/synchronous/);
      expect(count()).toBe(0);
    });
  });
});
