create schema if not exists gcssync;
set search_path=gcssync,public;

DO $$ BEGIN
  CREATE TYPE gcssync_direction as enum ('fcrepo-to-gcs', 'gcs-to-fcrepo');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS update_status (
  update_status_id SERIAL PRIMARY KEY,
  updated timestamp NOT NULL DEFAULT NOW(),
  path TEXT NOT NULL,
  direction gcssync_direction NOT NULL,
  gcs_bucket TEXT NOT NULL,
  gcs_path TEXT NOT NULL,
  error TEXT,
  message TEXT,
  event JSONB,
  UNIQUE (path, direction, gcs_bucket)
);
CREATE INDEX IF NOT EXISTS update_status_path_idx ON update_status (path);
CREATE INDEX IF NOT EXISTS update_status_gcs_bucket_idx ON update_status (gcs_bucket);
CREATE INDEX IF NOT EXISTS update_status_gcs_path_idx ON update_status (gcs_path);