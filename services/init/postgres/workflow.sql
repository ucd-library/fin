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