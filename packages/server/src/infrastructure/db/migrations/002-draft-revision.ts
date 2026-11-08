/** Draft revision for optimistic locking of editor changes (phase 2). */
export const sql = `
ALTER TABLE drafts ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0);
`;
