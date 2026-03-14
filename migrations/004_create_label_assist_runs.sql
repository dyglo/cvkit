CREATE TABLE IF NOT EXISTS label_assist_runs (
  id          SERIAL PRIMARY KEY,
  run_id      INTEGER REFERENCES runs(id),
  image_path  TEXT NOT NULL,
  classes     TEXT NOT NULL,
  save_path   TEXT,
  annotations TEXT,
  notes       TEXT,
  tokens_used INTEGER,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
