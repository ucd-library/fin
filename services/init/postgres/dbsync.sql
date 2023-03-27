create schema if not exists dbsync;
set search_path=dbsync,public;

DO $$ BEGIN
  CREATE TYPE fcrepo_update_type as enum ('Create', 'Update', 'Delete', 'Follow', 'Purge', 'Reindex');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE dbsync_message_status as enum ('pending', 'processing');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE dbsync_reindex_crawl_state as enum ('stopped', 'crawling');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;


CREATE TABLE IF NOT EXISTS event_queue (
  event_queue_id SERIAL PRIMARY KEY,
  updated timestamp NOT NULL DEFAULT NOW(),
  path TEXT NOT NULL UNIQUE,
  update_types fcrepo_update_type[] NOT NULL,
  container_types text[] NOT NULL,
  status dbsync_message_status NOT NULL DEFAULT 'pending',
  event_id TEXT NOT NULL UNIQUE,
  event_timestamp timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS event_queue_path_idx ON event_queue (path);
CREATE INDEX IF NOT EXISTS event_queue_updated_idx ON event_queue (updated);
CREATE INDEX IF NOT EXISTS event_queue_status_idx ON event_queue (status);

CREATE TABLE IF NOT EXISTS update_status (
  update_status_id SERIAL PRIMARY KEY,
  updated timestamp NOT NULL DEFAULT NOW(),
  path TEXT NOT NULL,
  update_types fcrepo_update_type[] NOT NULL,
  container_types text[] NOT NULL,
  workflow_types text[],
  event_id TEXT NOT NULL,
  event_timestamp timestamp NOT NULL,
  action TEXT NOT NULL,
  transform_service TEXT,
  model TEXT DEFAULT '',
  message TEXT,
  db_response JSONB,
  source JSONB,
  UNIQUE(path, model)
);
CREATE INDEX IF NOT EXISTS update_status_path_idx ON update_status (path);
CREATE INDEX IF NOT EXISTS update_status_action_idx ON update_status (action);

CREATE TABLE IF NOT EXISTS reindex_crawl_status (
  reindex_crawl_status_id SERIAL PRIMARY KEY,
  updated timestamp NOT NULL DEFAULT NOW(),
  path TEXT NOT NULL UNIQUE,
  state dbsync_reindex_crawl_state NOT NULL DEFAULT 'stopped',
  data JSONB
);
CREATE INDEX IF NOT EXISTS reindex_crawl_status_path_idx ON reindex_crawl_status (path);