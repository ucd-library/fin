create schema if not exists fin_cache;
set search_path=fin_cache,public;

CREATE TABLE IF NOT EXISTS quads_uri_ref (
  uri_ref_id SERIAL PRIMARY KEY,
  uri TEXT UNIQUE NOT NULL
);
CREATE INDEX IF NOT EXISTS quads_uri_ref_idx ON quads_uri_ref(uri);

CREATE TABLE IF NOT EXISTS quads (
  quads_id SERIAL PRIMARY KEY,
  fedora_id INTEGER REFERENCES quads_uri_ref(uri_ref_id),
  subject_id INTEGER REFERENCES quads_uri_ref(uri_ref_id),
  predicate_id INTEGER REFERENCES quads_uri_ref(uri_ref_id),
  object_value TEXT,
  object_type_id INTEGER REFERENCES quads_uri_ref(uri_ref_id),
  last_modified TIMESTAMP
);

CREATE OR REPLACE VIEW quads_view AS 
  SELECT
    (SELECT uri FROM quads_uri_ref WHERE uri_ref_id = fedora_id) AS fedora_id,
    (SELECT uri FROM quads_uri_ref WHERE uri_ref_id = subject_id) AS subject,
    (SELECT uri FROM quads_uri_ref WHERE uri_ref_id = predicate_id) AS predicate,
    (SELECT uri FROM quads_uri_ref WHERE uri_ref_id = object_type_id) AS object_type,
    object_value as object,
    last_modified
  FROM quads;


CREATE OR REPLACE FUNCTION quads_insert (
  fedora_id_in TEXT,
  subject_id_in TEXT,
  predicate_in TEXT,
  object_value_in TEXT,
  object_type_in TEXT,
  modified_in TIMESTAMP
) RETURNS void AS $$
DECLARE
  fid INTEGER;
  sid INTEGER;
  pid INTEGER;
  otid INTEGER;
BEGIN

  INSERT INTO fin_cache.quads_uri_ref (uri) VALUES (fedora_id_in) ON CONFLICT DO NOTHING;
  SELECT uri_ref_id INTO fid FROM fin_cache.quads_uri_ref WHERE uri = fedora_id_in;

  INSERT INTO fin_cache.quads_uri_ref (uri) VALUES (subject_id_in) ON CONFLICT DO NOTHING;
  SELECT uri_ref_id INTO sid FROM fin_cache.quads_uri_ref WHERE uri = subject_id_in;

  INSERT INTO fin_cache.quads_uri_ref (uri) VALUES (predicate_in) ON CONFLICT DO NOTHING;
  SELECT uri_ref_id INTO pid FROM fin_cache.quads_uri_ref WHERE uri = predicate_in;

  INSERT INTO fin_cache.quads_uri_ref (uri) VALUES (object_type_in) ON CONFLICT DO NOTHING;
  SELECT uri_ref_id INTO otid FROM fin_cache.quads_uri_ref WHERE uri = object_type_in;

  INSERT INTO fin_cache.quads (fedora_id, subject_id, predicate_id, object_value, object_type_id, last_modified)
  VALUES (fid, sid, pid, object_value_in, otid, modified_in);

END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION quads_delete (
  fedora_id_in TEXT
) RETURNS void AS $$
DECLARE
  fid INTEGER;
BEGIN
  SELECT uri_ref_id INTO fid FROM fin_cache.quads_uri_ref WHERE uri = fedora_id_in;

  IF fid IS NULL THEN
    RETURN;
  END IF;
  DELETE FROM fin_cache.quads WHERE fedora_id = fid;
END;
$$ LANGUAGE plpgsql;
