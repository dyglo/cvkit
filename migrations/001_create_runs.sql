CREATE TABLE IF NOT EXISTS runs (
  id          SERIAL PRIMARY KEY,
  command     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'success',
  duration_ms INTEGER,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
