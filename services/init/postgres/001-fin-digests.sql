create schema if not exists fin_digests;
set search_path=fin_digests,public;

CREATE TABLE IF NOT EXISTS type_ref (
  type_ref_id SERIAL PRIMARY KEY,
  type TEXT UNIQUE NOT NULL
);
CREATE INDEX IF NOT EXISTS type_ref_idx ON type_ref(type);

CREATE TABLE IF NOT EXISTS digests (
  digest_id SERIAL PRIMARY KEY,
  path TEXT,
  type_ref_id INTEGER REFERENCES type_ref(type_ref_id),
  digest TEXT,
  state_token TEXT,
  cache_time TIMESTAMP DEFAULT NOW(),
  UNIQUE (path, type_ref_id)
);
CREATE INDEX IF NOT EXISTS digests_path_idx ON digests(path);

CREATE OR REPLACE VIEW digests_view AS
SELECT 
  digests.path AS path,
  type_ref.type AS type,
  digests.digest AS digest,
  digests.state_token AS state_token,
  digests.cache_time AS cache_time
FROM digests
JOIN type_ref ON digests.type_ref_id = type_ref.type_ref_id;

CREATE OR REPLACE FUNCTION digests_insert (
  data JSON
) RETURNS void AS $$
DECLARE
  tid INTEGER;
  digest JSON;
BEGIN

  FOR digest IN SELECT * FROM json_array_elements(data->'digests')
  LOOP
    INSERT INTO fin_digests.type_ref (type) VALUES (digest->>'type') ON CONFLICT DO NOTHING;
    SELECT type_ref_id INTO tid FROM fin_digests.type_ref WHERE type = digest->>'type';

    INSERT INTO fin_digests.digests 
      (path, type_ref_id, digest, state_token)
    VALUES
      (data->>'path', tid, digest->>'value', data->>'stateToken');
  END LOOP;
END;
$$ LANGUAGE plpgsql;