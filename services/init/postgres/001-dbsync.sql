create schema if not exists dbsync;
set search_path=dbsync,public;

DO $$ BEGIN
  CREATE TYPE fcrepo_update_type as enum ('Create', 'Update', 'Delete', 'Follow', 'Purge', 'Reindex', 'integration-test-ping');
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
  path TEXT NOT NULL,
  update_types fcrepo_update_type[] NOT NULL,
  container_types text[] NOT NULL,
  status dbsync_message_status NOT NULL DEFAULT 'pending',
  event_id TEXT NOT NULL UNIQUE,
  event_timestamp timestamp NOT NULL,
  UNIQUE(path, status)
);
CREATE INDEX IF NOT EXISTS event_queue_path_idx ON event_queue (path);
CREATE INDEX IF NOT EXISTS event_queue_created_idx ON event_queue (updated);
CREATE INDEX IF NOT EXISTS event_queue_status_idx ON event_queue (status);

CREATE TABLE IF NOT EXISTS validate_queue (
  validate_queue_id SERIAL PRIMARY KEY,
  created timestamp NOT NULL DEFAULT NOW(),
  updated timestamp NOT NULL DEFAULT NOW(),
  model TEXT NOT NULL,
  db_id TEXT NOT NULL,
  UNIQUE(model, db_id)
);
CREATE INDEX IF NOT EXISTS validate_queue_db_id_idx ON validate_queue (db_id);
CREATE INDEX IF NOT EXISTS validate_queue_updated_idx ON validate_queue (updated);

CREATE TABLE IF NOT EXISTS validate_response (
  validate_response_id SERIAL PRIMARY KEY,
  updated timestamp NOT NULL DEFAULT NOW(),
  db_id TEXT NOT NULL,
  model TEXT NOT NULL,
  response JSONB NOT NULL,
  UNIQUE(db_id, model)
);
CREATE INDEX IF NOT EXISTS validate_response_model_idx ON validate_response (model);
CREATE INDEX IF NOT EXISTS validate_response_db_id_idx ON validate_response (db_id);
CREATE INDEX IF NOT EXISTS  validate_response_errors_idx ON validate_response (jsonb_array_length(response->'errors'));
CREATE INDEX IF NOT EXISTS  validate_response_warnings_idx ON validate_response (jsonb_array_length(response->'warnings'));
CREATE INDEX IF NOT EXISTS  validate_response_comments_idx ON validate_response (jsonb_array_length(response->'comments'));

CREATE TABLE IF NOT EXISTS update_status (
  update_status_id SERIAL PRIMARY KEY,
  created timestamp DEFAULT NOW(),
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
  db_id TEXT,
  validate_response_id INTEGER REFERENCES validate_response(validate_response_id),
  source JSONB,
  update_count INTEGER DEFAULT 1,
  UNIQUE(path, model)
);
CREATE INDEX IF NOT EXISTS update_status_path_idx ON update_status (path);
CREATE INDEX IF NOT EXISTS update_status_action_idx ON update_status (action);
CREATE INDEX IF NOT EXISTS update_status_model_idx ON update_status (model);
CREATE INDEX IF NOT EXISTS update_status_db_id_idx ON update_status (db_id);

CREATE OR REPLACE VIEW validate_response_view AS
  SELECT 
    validate_response_id, 
    updated, 
    db_id, 
    model, 
    response, 
    jsonb_array_length(response->'errors') as error_count, 
    jsonb_array_length(response->'warnings') as warning_count, 
    jsonb_array_length(response->'comments') as comment_count
  FROM 
    validate_response;

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
  db_id_in TEXT,
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
      update_status (path, event_id, event_timestamp, container_types, 
        update_types, workflow_types, action, message, db_response, db_id, 
        transform_service, model, source)
    VALUES 
      (path_in, event_id_in, event_timestamp_in, container_types_in, 
      update_types_in, workflow_types_in, action_in, message_in, db_response_in, db_id_in,
      transform_service_in, model_in, source_in);
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
      db_id = db_id_in,
      transform_service = transform_service_in,
      source = source_in,
      updated = NOW(),
      update_count = count + 1
    WHERE 
      update_status_id = usid;
  END IF;


END;
$$ LANGUAGE plpgsql;

-- upsert function for update_status
CREATE OR REPLACE FUNCTION upsert_validate_response (
  model_in TEXT,
  db_id_in TEXT,
  response_in JSONB
) RETURNS INTEGER AS $$
DECLARE
  vrid INTEGER;
BEGIN

  SELECT 
    validate_response_id INTO vrid
  FROM
    validate_response 
  WHERE 
    model = model_in AND db_id = db_id_in;

  IF vrid IS NULL THEN
    INSERT INTO 
      validate_response (model, db_id, response)
    VALUES 
      (model_in, db_id_in, response_in)
    RETURNING validate_response_id INTO vrid;
  ELSE
    UPDATE validate_response SET
      response = response_in,
      updated = NOW()
    WHERE 
      validate_response_id = vrid;
  END IF;

  RETURN vrid;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION upsert_validate_queue (
  model_in TEXT,
  db_id_in TEXT
) RETURNS void AS $$
DECLARE
  vqid INTEGER;
BEGIN

  SELECT
    validate_queue_id INTO vqid
  FROM
    validate_queue 
  WHERE 
    model = model_in AND db_id = db_id_in;

  IF vqid IS NULL THEN
    INSERT INTO 
      validate_queue (model, db_id)
    VALUES 
      (model_in, db_id_in);
  ELSE
    UPDATE validate_queue SET
      updated = NOW()
    WHERE 
      validate_queue_id = vqid;
  END IF;

END;
$$ LANGUAGE plpgsql;

-- remove validation status from update_status then delete validate_response
CREATE OR REPLACE FUNCTION delete_validate_response (
  model_in TEXT,
  db_id_in TEXT
) RETURNS void AS $$
DECLARE
  vrid INTEGER;
BEGIN
  SELECT 
    validate_response_id INTO vrid
  FROM
    validate_response 
  WHERE 
    model = model_in AND db_id = db_id_in;

  UPDATE update_status SET
    validate_response_id = NULL,
    updated = NOW()
  WHERE 
    validate_response_id = vrid;

  DELETE FROM validate_response WHERE model = model_in AND db_id = db_id_in;
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