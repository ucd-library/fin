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
  update_count INTEGER DEFAULT 1,
  UNIQUE(path, model)
);
CREATE INDEX IF NOT EXISTS update_status_path_idx ON update_status (path);
CREATE INDEX IF NOT EXISTS update_status_action_idx ON update_status (action);

-- upsert function for update_status
CREATE OR REPLACE FUNCTION upsert_update_status (
  path_in TEXT, 
  model_in TEXT, 
  event_id_in TEXT, 
  event_timestamp_in TIMESTAMP, 
  container_types_in TEXT[], 
  update_types_in fcrepo_update_type[], 
  workflow_types_in TEXT[], 
  action_in TEXT, 
  message_in TEXT, 
  db_response_in JSONB, 
  transform_service_in TEXT, 
  source_in JSONB
) RETURNS void AS $$
DECLARE
  usid INTEGER;
  count INTEGER;
BEGIN

  SELECT 
    update_status_id, update_count INTO usid, count
  FROM 
    update_status 
  WHERE 
    path = path_in AND model = model_in;

  IF usid IS NULL THEN
    INSERT INTO 
      update_status (path, event_id, event_timestamp, container_types, update_types, workflow_types, action, message, db_response, transform_service, model, source)
    VALUES 
      (path_in, event_id_in, event_timestamp_in, container_types_in, update_types_in, workflow_types_in, action_in, message_in, db_response_in, transform_service_in, model_in, source_in);
  ELSE
    UPDATE update_status SET
      event_id = event_id_in,
      event_timestamp = event_timestamp_in,
      container_types = container_types_in,
      update_types = update_types_in,
      workflow_types = workflow_types_in,
      action = action_in,
      message = message_in,
      db_response = db_response_in,
      transform_service = transform_service_in,
      source = source_in,
      updated = NOW(),
      update_count = count + 1
    WHERE 
      update_status_id = usid;
  END IF;


END;
$$ LANGUAGE plpgsql;


CREATE TABLE IF NOT EXISTS reindex_crawl_status (
  reindex_crawl_status_id SERIAL PRIMARY KEY,
  updated timestamp NOT NULL DEFAULT NOW(),
  path TEXT NOT NULL UNIQUE,
  state dbsync_reindex_crawl_state NOT NULL DEFAULT 'stopped',
  data JSONB
);
CREATE INDEX IF NOT EXISTS reindex_crawl_status_path_idx ON reindex_crawl_status (path);