CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  error TEXT NOT NULL DEFAULT '',
  request_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX jobs_created_at_idx ON jobs(created_at DESC);
