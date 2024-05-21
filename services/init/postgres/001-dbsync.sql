create schema if not exists dbsync;

set search_path=public;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

set search_path=dbsync,public;

DO $$ BEGIN
  CREATE TYPE fcrepo_update_type as enum ('Create', 'Update', 'Delete', 'Follow', 'Purge', 'Reindex', 'IntegrationTestPing');
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

-- upsert event queue

CREATE OR REPLACE FUNCTION upsert_event_queue (
  path_in TEXT, 
  update_types_in fcrepo_update_type[], 
  container_types_in TEXT[], 
  event_id_in TEXT, 
  event_timestamp_in TIMESTAMP WITH TIME ZONE
) RETURNS void AS $$

  INSERT INTO event_queue 
    (path, event_id, event_timestamp, container_types, update_types, status) 
  VALUES 
    (path_in, event_id_in, event_timestamp_in, container_types_in, update_types_in, 'pending')
  ON CONFLICT (path, status) DO UPDATE SET
    event_id = event_id_in,
    event_timestamp = event_timestamp_in,
    container_types = container_types_in,
    update_types = update_types_in,
    status = 'pending',
    updated = now()

$$ LANGUAGE SQL;


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
  UNIQUE(db_id, model)
);
CREATE INDEX IF NOT EXISTS validate_response_model_idx ON validate_response (model);
CREATE INDEX IF NOT EXISTS validate_response_db_id_idx ON validate_response (db_id);

CREATE TABLE IF NOT EXISTS validate_response_item (
  validate_response_item_id SERIAL PRIMARY KEY,
  validate_response_id INTEGER REFERENCES validate_response(validate_response_id),
  type TEXT NOT NULL,
  label TEXT,
  id TEXT,
  additional_info JSONB
);
CREATE INDEX IF NOT EXISTS validate_response_item_type_idx ON validate_response_item (type);
CREATE INDEX IF NOT EXISTS validate_response_item_label_idx ON validate_response_item (label);

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
CREATE INDEX IF NOT EXISTS update_status_update_types_idx ON update_status (update_types);


CREATE OR REPLACE FUNCTION query_validate_response (
  model_in TEXT,
  type_in TEXT,
  label_in TEXT
) RETURNS TABLE (
  validate_response_id INTEGER,
  updated TIMESTAMP,
  db_id TEXT,
  model TEXT,
  labels TEXT[],
  responses JSON,
  error_count BIGINT,
  warning_count BIGINT,
  comment_count BIGINT
) AS $$
DECLARE
  vrids INTEGER[];
BEGIN
  if model_in = '' then
    model_in := null;
  end if;

  if type_in = '' then
    type_in := null;
  end if;

  if label_in = '' then
    label_in := null;
  end if;

  SELECT 
    array_agg(distinct vri.validate_response_id) INTO vrids
  FROM
    dbsync.validate_response_item vri 
  WHERE 
    (label_in IS NULL OR vri.label = label_in) AND
    (type_in IS NULL OR vri.type = type_in);

  RETURN QUERY
  SELECT 
    vr.validate_response_id, 
    vr.updated, 
    vr.db_id, 
    vr.model, 
    array_agg(vri.label) as labels,
    json_agg(row_to_json(vri.*)) as responses,
    count(*) FILTER (WHERE type = 'error') as error_count,
    count(*) FILTER (WHERE type = 'warning') as warning_count,
    count(*) FILTER (WHERE type = 'comment') as comment_count
  FROM
    dbsync.validate_response vr
  LEFT JOIN
    dbsync.validate_response_item vri ON vr.validate_response_id = vri.validate_response_id
  WHERE
    vr.validate_response_id = ANY(vrids) AND
    (model_in IS NULL OR vr.model = model_in)
  GROUP BY
    vr.validate_response_id, 
    vr.updated, 
    vr.db_id, 
    vr.model;

END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE VIEW validate_response_view AS
  SELECT 
    vr.validate_response_id, 
    vr.updated, 
    vr.db_id, 
    vr.model, 
    array_agg(vri.label) as labels,
    json_agg(row_to_json(vri.*)) as responses,
    count(*) FILTER (WHERE type = 'error') as error_count,
    count(*) FILTER (WHERE type = 'warning') as warning_count,
    count(*) FILTER (WHERE type = 'comment') as comment_count 
  FROM 
    validate_response_item vri
  LEFT JOIN
    validate_response vr ON vri.validate_response_id = vr.validate_response_id
  GROUP BY
    vr.validate_response_id, 
    vr.updated, 
    vr.db_id, 
    vr.model;

CREATE OR REPLACE VIEW validate_response_stats AS
  WITH vr_item_model AS (
    SELECT 
      model,
      type,
      label
    FROM 
      validate_response_item vri
    LEFT JOIN
      validate_response vr ON vri.validate_response_id = vr.validate_response_id
  )
  SELECT 
    type,
    label, 
    model,
    count(*) as count
  FROM 
    vr_item_model
  GROUP BY 
    type, label, model;

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

  INSERT INTO 
    update_status (path, event_id, event_timestamp, container_types, 
      update_types, workflow_types, action, message, db_response, db_id, 
      transform_service, model, source)
  VALUES 
    (path_in, event_id_in, event_timestamp_in, container_types_in, 
    update_types_in, workflow_types_in, action_in, message_in, db_response_in, db_id_in,
    transform_service_in, model_in, source_in)
  ON CONFLICT (path, model) DO UPDATE SET
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
    update_count = update_status.update_count + 1;

END;
$$ LANGUAGE plpgsql;

-- upsert function for update_status
CREATE OR REPLACE FUNCTION upsert_validate_response (
  model_in TEXT,
  db_id_in TEXT
) RETURNS INTEGER AS $$
DECLARE
  vrid INTEGER;
BEGIN

  INSERT INTO 
    validate_response (model, db_id)
  VALUES 
    (model_in, db_id_in)
  ON CONFLICT (model, db_id) DO UPDATE SET
    updated = NOW()
  RETURNING validate_response_id INTO vrid;

  -- Clean up the items
  DELETE FROM validate_response_item WHERE validate_response_id = vrid;

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

  INSERT INTO 
    validate_queue (model, db_id)
  VALUES 
    (model_in, db_id_in)
  ON CONFLICT (model, db_id) DO UPDATE SET
    updated = NOW();

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

  IF vrid IS NOT NULL THEN
    UPDATE update_status SET
      validate_response_id = NULL,
      updated = NOW()
    WHERE 
      validate_response_id = vrid;
  END IF;

  DELETE FROM validate_response_item WHERE validate_response_id = vrid;
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