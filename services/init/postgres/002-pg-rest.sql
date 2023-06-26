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

CREATE OR REPLACE VIEW activemq_integration_test AS
  SELECT * FROM activemq.integration_test;

CREATE OR REPLACE VIEW activemq_integration_test_state AS
  SELECT * FROM activemq.integration_test_state;

CREATE OR REPLACE VIEW activemq_integration_test_stats AS
  SELECT * FROM activemq.integration_test_stats
  ORDER BY date_hour DESC;

CREATE OR REPLACE FUNCTION activemq_integration_test_stats_window(days integer)
  RETURNS TABLE(
    date_hour timestamp,
    action text,
    agent text,
    min_timing integer,
    max_timing integer,
    average_timing float,
    count integer
  ) AS $$
      SELECT * FROM activemq_integration_test_stats WHERE date_hour > NOW() - INTERVAL '1 days' * days;
  $$ LANGUAGE SQL;

CREATE OR REPLACE VIEW dbsync_event_queue AS
  SELECT * FROM dbsync.event_queue;

CREATE OR REPLACE VIEW dbsync_event_queue_size AS
  SELECT count(*) FROM dbsync.event_queue;

CREATE OR REPLACE VIEW dbsync_validate_queue_size AS
  SELECT count(*) FROM dbsync.validate_queue;

CREATE OR REPLACE VIEW dbsync_update_status AS
  SELECT 
    us.*, 
    vr.response as validation_response,
    vr.error_count as validation_error_count,
    vr.warning_count as validation_warning_count,
    vr.comment_count as validation_comment_count
  FROM 
    dbsync.update_status us
  LEFT JOIN 
    dbsync.validate_response_view vr on us.validate_response_id = vr.validate_response_id; 

CREATE OR REPLACE VIEW dbsync_validate_response_view AS
  SELECT 
    vr.validate_response_id, 
    vr.updated,
    vr.db_id,
    vr.model, 
    vr.response,
    vr.error_count,
    vr.warning_count,
    vr.comment_count,
    array_agg(us.path) as paths
  FROM 
    dbsync.validate_response_view vr
  LEFT JOIN 
    dbsync.update_status us on vr.validate_response_id = us.validate_response_id
  GROUP BY
    vr.validate_response_id, 
    vr.updated,
    vr.db_id,
    vr.model, 
    vr.response,
    vr.error_count,
    vr.warning_count,
    vr.comment_count;

CREATE OR REPLACE VIEW dbsync_stats AS
  SELECT action, count(*) as count FROM dbsync.update_status GROUP BY action;

CREATE OR REPLACE VIEW dbsync_model_item_stats AS 
  WITH models AS (
    SELECT distinct model FROM dbsync.validate_response
  ),
  errors AS (
    SELECT 
      model, 
      sum(error_count) AS count 
    FROM 
      dbsync.validate_response_view 
    WHERE error_count > 0
    GROUP BY model
  ),
  warnings AS (
    SELECT 
      model, 
      sum(warning_count) AS count 
    FROM 
      dbsync.validate_response_view 
    WHERE warning_count > 0
    GROUP BY model
  ),
  comments AS (
    SELECT 
      model, 
      sum(comment_count) AS count 
    FROM 
      dbsync.validate_response_view 
    WHERE comment_count > 0
    GROUP BY model
  )
  SELECT 
    models.model, 
    errors.count AS error_count, 
    warnings.count AS warning_count, 
    comments.count AS comment_count
  FROM models
  LEFT JOIN errors ON models.model = errors.model
  LEFT JOIN warnings ON models.model = warnings.model
  LEFT JOIN comments ON models.model = comments.model;

CREATE OR REPLACE VIEW dbsync_reindex_crawl_status AS
  SELECT * FROM dbsync.reindex_crawl_status;

CREATE OR REPLACE VIEW fcrepo_path_type AS
  SELECT fedora_id, rdf_type_uri
  FROM simple_search ss
  LEFT JOIN search_resource_rdf_type srrt ON ss.id = srrt.resource_id
  LEFT JOIN search_rdf_type srt ON srrt.rdf_type_id = srt.id;

CREATE OR REPLACE VIEW fcrepo_type_stats AS
  SELECT 
    rdf_type_uri, count(*) AS count 
  FROM 
    fcrepo_path_type 
  GROUP BY rdf_type_uri 
  ORDER BY count DESC;

CREATE OR REPLACE VIEW gcssync_update_state AS
  SELECT * FROM gcssync.update_status;

CREATE OR REPLACE VIEW gcssync_disk_cache AS
  SELECT * FROM gcssync.disk_cache;

CREATE OR REPLACE VIEW gcssync_disk_cache_stats AS
  SELECT content_type, count(*) as count, sum(size) as total_size_kb FROM gcssync.disk_cache GROUP BY content_type;

CREATE OR REPLACE VIEW workflow_workflow AS
  SELECT *, data->>'finPath' as path FROM workflow.workflow;

CREATE OR REPLACE VIEW workflow_lastest AS
  SELECT *
  FROM (
    SELECT *,
          ROW_NUMBER() OVER (PARTITION BY path, name ORDER BY updated DESC) AS rn
    FROM workflow_workflow
  ) subquery
  WHERE rn = 1;

CREATE OR REPLACE VIEW workflow_workflow_gcs AS
  SELECT * FROM workflow.workflow_gcs;

CREATE OR REPLACE VIEW workflow_stats AS
  SELECT name, state, count(*) as count from workflow_lastest GROUP BY name, state ORDER BY name, count;

GRANT SELECT, INSERT, UPDATE, DELETE
ON ALL TABLES IN SCHEMA restapi 
TO admin_rest_api;
GRANT USAGE ON SCHEMA restapi TO admin_rest_api;
grant execute on all functions in schema restapi to admin_rest_api;