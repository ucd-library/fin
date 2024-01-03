create schema if not exists workflow;
set search_path=workflow,public;

DO $$ BEGIN
  CREATE TYPE fin_workflow_state as enum ('pending', 'init', 'running', 'completed', 'deleted', 'error');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS workflow (
  workflow_id UUID PRIMARY KEY,
  created timestamp NOT NULL DEFAULT NOW(),
  updated timestamp NOT NULL DEFAULT NOW(),
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  state fin_workflow_state NOT NULL,
  data JSONB,
  error TEXT
);
CREATE INDEX IF NOT EXISTS workflow_data_finpath_idx ON workflow((data->>'finPath'));
CREATE INDEX IF NOT EXISTS workflow_data_state_idx ON workflow(state);
CREATE INDEX IF NOT EXISTS workflow_data_name_idx ON workflow(name);
CREATE INDEX IF NOT EXISTS workflow_data_updated_idx ON workflow(updated);

CREATE TABLE IF NOT EXISTS workflow_gcs (
  workflow_gcs SERIAL PRIMARY KEY,
  workflow_id UUID REFERENCES workflow(workflow_id) ON DELETE CASCADE,
  file_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS workflow_gcs_file_hash_idx ON workflow_gcs(file_hash);