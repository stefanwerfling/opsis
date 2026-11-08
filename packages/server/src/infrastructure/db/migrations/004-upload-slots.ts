/** Two-stage uploads (06 `opsis_request_upload`): one-time slots, only the token hash is stored. */
export const sql = `
CREATE TABLE upload_slots (
  id             TEXT PRIMARY KEY,
  token_hash     TEXT NOT NULL UNIQUE,
  project_id     TEXT NOT NULL REFERENCES projects(id),
  session_id     TEXT NOT NULL REFERENCES sessions(id),
  agent_id       TEXT REFERENCES agents(id),
  request        TEXT NOT NULL,                 -- validated submit input without the image (JSON)
  status         TEXT NOT NULL CHECK (status IN ('open','completed','expired')),
  created_at     TEXT NOT NULL,
  expires_at     TEXT NOT NULL,
  completed_at   TEXT,
  screenshot_id  TEXT REFERENCES screenshots(id)
);
CREATE INDEX upload_slots_open ON upload_slots(expires_at) WHERE status = 'open';
`;
