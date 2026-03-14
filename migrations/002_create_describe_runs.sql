CREATE TABLE IF NOT EXISTS describe_runs (
  id              SERIAL PRIMARY KEY,
  run_id          INTEGER REFERENCES runs(id),
  image_path      TEXT NOT NULL,
  description     TEXT,
  objects         TEXT,
  suggested_tasks TEXT,
  quality_notes   TEXT,
  tokens_used     INTEGER,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
