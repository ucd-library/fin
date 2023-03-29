create schema if not exists activemq;
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