create schema if not exists fin_cache;
set search_path=fin_cache,public;

CREATE TABLE IF NOT EXISTS quads_uri_ref (
  uri_ref_id SERIAL PRIMARY KEY,
  uri TEXT UNIQUE NOT NULL
);
CREATE INDEX IF NOT EXISTS quads_uri_ref_idx ON quads_uri_ref(uri);

CREATE TABLE IF NOT EXISTS quads (
  quads_id SERIAL PRIMARY KEY,
  fin_path_id INTEGER REFERENCES quads_uri_ref(uri_ref_id),
  fedora_id INTEGER REFERENCES quads_uri_ref(uri_ref_id),
  subject_id INTEGER REFERENCES quads_uri_ref(uri_ref_id),
  predicate_id INTEGER REFERENCES quads_uri_ref(uri_ref_id),
  object_value TEXT,
  object_type_id INTEGER REFERENCES quads_uri_ref(uri_ref_id),
  last_modified TIMESTAMP,
  cache_time TIMESTAMP DEFAULT NOW(),
  UNIQUE (fin_path_id, fedora_id, subject_id, predicate_id, object_value, object_type_id)
);
CREATE INDEX IF NOT EXISTS quads_fedora_id_idx ON quads(fedora_id);
CREATE INDEX IF NOT EXISTS quads_subject_id_idx ON quads(subject_id);
CREATE INDEX IF NOT EXISTS quads_predicate_id_idx ON quads(predicate_id);

CREATE OR REPLACE VIEW quads_view AS 
  SELECT
    quads_id as quads_id,
    fp.uri AS fin_path,
    f.uri AS fedora_id,
    s.uri AS subject,
    p.uri AS predicate,
    o.uri AS object_type,
    object_value as object,
    last_modified,
    cache_time
  FROM quads
  LEFT JOIN quads_uri_ref fp ON fp.uri_ref_id = fin_path_id
  LEFT JOIN quads_uri_ref f ON f.uri_ref_id = fedora_id
  LEFT JOIN quads_uri_ref s ON s.uri_ref_id = subject_id
  LEFT JOIN quads_uri_ref p ON p.uri_ref_id = predicate_id
  LEFT JOIN quads_uri_ref o ON o.uri_ref_id = object_type_id;


CREATE OR REPLACE FUNCTION quads_insert (
  fin_path_in TEXT,
  fedora_id_in TEXT,
  subject_id_in TEXT,
  predicate_in TEXT,
  object_value_in TEXT,
  object_type_in TEXT,
  modified_in TIMESTAMP
) RETURNS void AS $$
DECLARE
  fpid INTEGER;
  fid INTEGER;
  sid INTEGER;
  pid INTEGER;
  otid INTEGER;
BEGIN

  INSERT INTO fin_cache.quads_uri_ref (uri) VALUES (fin_path_in) ON CONFLICT DO NOTHING;
  SELECT uri_ref_id INTO fpid FROM fin_cache.quads_uri_ref WHERE uri = fin_path_in;

  INSERT INTO fin_cache.quads_uri_ref (uri) VALUES (fedora_id_in) ON CONFLICT DO NOTHING;
  SELECT uri_ref_id INTO fid FROM fin_cache.quads_uri_ref WHERE uri = fedora_id_in;

  INSERT INTO fin_cache.quads_uri_ref (uri) VALUES (subject_id_in) ON CONFLICT DO NOTHING;
  SELECT uri_ref_id INTO sid FROM fin_cache.quads_uri_ref WHERE uri = subject_id_in;

  INSERT INTO fin_cache.quads_uri_ref (uri) VALUES (predicate_in) ON CONFLICT DO NOTHING;
  SELECT uri_ref_id INTO pid FROM fin_cache.quads_uri_ref WHERE uri = predicate_in;

  INSERT INTO fin_cache.quads_uri_ref (uri) VALUES (object_type_in) ON CONFLICT DO NOTHING;
  SELECT uri_ref_id INTO otid FROM fin_cache.quads_uri_ref WHERE uri = object_type_in;

  INSERT INTO fin_cache.quads (fin_path_id, fedora_id, subject_id, predicate_id, object_value, object_type_id, last_modified, cache_time)
  VALUES (fpid, fid, sid, pid, object_value_in, otid, modified_in, NOW()) ON CONFLICT DO NOTHING;

END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION quads_delete (
  fin_path_in TEXT
) RETURNS void AS $$
DECLARE
  fpid INTEGER;
BEGIN
  SELECT uri_ref_id INTO fpid FROM fin_cache.quads_uri_ref WHERE uri = fin_path_in;

  IF fpid IS NULL THEN
    RETURN;
  END IF;
  DELETE FROM fin_cache.quads WHERE fin_path_id = fpid;
END;
$$ LANGUAGE plpgsql;
