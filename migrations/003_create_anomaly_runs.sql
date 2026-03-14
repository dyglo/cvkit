CREATE TABLE IF NOT EXISTS anomaly_runs (
  id          SERIAL PRIMARY KEY,
  run_id      INTEGER REFERENCES runs(id),
  dir_path    TEXT NOT NULL,
  image_path  TEXT NOT NULL,
  is_anomaly  BOOLEAN NOT NULL,
  reason      TEXT,
  confidence  TEXT,
  tokens_used INTEGER,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
