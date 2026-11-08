/** Base version a session was rebased from ("Basis aktualisiert von V3 auf V4", phase 4). */
export const sql = `
ALTER TABLE sessions ADD COLUMN rebased_from_version_id TEXT REFERENCES ui_versions(id);
`;
