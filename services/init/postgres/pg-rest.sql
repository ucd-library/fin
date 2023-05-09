create schema if not exists restapi;
set search_path=restapi,public;

-- create pg rest base user (if no role provided)
DO $$BEGIN
IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'admin_rest_api')
THEN CREATE ROLE admin_rest_api;
END IF;
END$$;

CREATE OR REPLACE VIEW activemq_debug_log AS
  SELECT * FROM activemq.debug_log;

CREATE OR REPLACE VIEW dbsync_event_queue AS
  SELECT * FROM dbsync.event_queue;

CREATE OR REPLACE VIEW dbsync_update_status AS
  SELECT * FROM dbsync.update_status;

CREATE OR REPLACE VIEW dbsync_reindex_crawl_status AS
  SELECT * FROM dbsync.reindex_crawl_status;

CREATE OR REPLACE VIEW gcssync_update_state AS
  SELECT * FROM gcssync.update_status;

CREATE OR REPLACE VIEW gcssync_disk_cache AS
  SELECT * FROM gcssync.disk_cache;

CREATE OR REPLACE VIEW workflow_workflow AS
  SELECT * FROM workflow.workflow;

CREATE OR REPLACE VIEW workflow_workflow_gcs AS
  SELECT * FROM workflow.workflow_gcs;

GRANT SELECT, INSERT, UPDATE, DELETE
ON ALL TABLES IN SCHEMA restapi 
TO admin_rest_api;
GRANT USAGE ON SCHEMA restapi TO admin_rest_api;