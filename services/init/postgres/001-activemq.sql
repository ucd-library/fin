create schema if not exists activemq;
CREATE EXTENSION IF NOT EXISTS tablefunc;

set search_path=activemq,public;

CREATE TABLE IF NOT EXISTS debug_log (
  id SERIAL PRIMARY KEY,
  timestamp timestamp NOT NULL DEFAULT NOW(),
  client_name TEXT NOT NULL,
  client_id TEXT NOT NULL,
  event TEXT NOT NULL,
  message TEXT NOT NULL,
  stack_trace TEXT NOT NULL,
  connection_data JSONB
);
CREATE INDEX IF NOT EXISTS debug_log_client_name_idx ON debug_log(client_name);
CREATE INDEX IF NOT EXISTS debug_log_event_idx ON debug_log(event);
CREATE INDEX IF NOT EXISTS debug_log_timestamp_idx ON debug_log(timestamp);

CREATE TABLE IF NOT EXISTS integration_test (
  id TEXT PRIMARY KEY,
  created timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS integration_test_created_idx ON integration_test(created);

CREATE TABLE IF NOT EXISTS integration_test_action (
  id SERIAL PRIMARY KEY,
  integration_test_id TEXT NOT NULL REFERENCES integration_test(id),
  error BOOLEAN NOT NULL DEFAULT FALSE,
  action TEXT NOT NULL,
  timing INTEGER,
  message TEXT,
  timestamp timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS integration_test_action_integration_test_id_idx ON integration_test_action(integration_test_id);
CREATE INDEX IF NOT EXISTS integration_test_action_timestamp_idx ON integration_test_action(timestamp);
CREATE INDEX IF NOT EXISTS integration_test_action_action_idx ON integration_test_action(action);

CREATE OR REPLACE VIEW integration_test_actions AS
  SELECT integration_test_id as id, action FROM integration_test_action GROUP BY id, action;

CREATE OR REPLACE VIEW integration_test_state AS
  SELECT
    it.id AS id,
    it.created AS created,
    ita.action AS action,
    ita.error AS error,
    ita.timing as timing,
    ita.message AS message,
    ita.timestamp AS timestamp
  FROM integration_test it
  LEFT JOIN integration_test_action ita ON ita.integration_test_id = it.id
  ORDER BY it.created DESC;

CREATE OR REPLACE VIEW integration_test_stats AS
  SELECT
    DATE_TRUNC('hour', it.created) AS date_hour,
    ita.action AS action,
    MIN(ita.timing) as min_timing,
    MAX(ita.timing) as max_timing,
    AVG(ita.timing) as average_timing,
    COUNT(ita.timing) as count
  FROM 
    integration_test it
  LEFT JOIN 
    integration_test_action ita 
  ON 
    ita.integration_test_id = it.id AND ita.error = false
  GROUP BY action, date_hour
  ORDER BY date_hour DESC;