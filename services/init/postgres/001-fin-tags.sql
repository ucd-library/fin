create schema if not exists fin_tags;
set search_path=fin_tags,public;

CREATE TABLE IF NOT EXISTS tag (
  tag_id SERIAL PRIMARY KEY,
  created timestamp NOT NULL DEFAULT NOW(),
  updated timestamp NOT NULL DEFAULT NOW(),
  subject TEXT NOT NULL,
  object TEXT NOT NULL,
  predicate TEXT NOT NULL,
  UNIQUE(subject, object, predicate)
);
CREATE INDEX IF NOT EXISTS tags_subject_idx ON tag (subject);

-- upsert function for disk_cache
CREATE OR REPLACE FUNCTION upsert_fin_tag (
  subject_in TEXT,
  predicate_in TEXT,
  object_in TEXT
) RETURNS void AS $$
DECLARE
  tid INTEGER;
BEGIN

  INSERT INTO fin_tags.tag 
    (subject, predicate, object)  
  VALUES 
    (subject_in, predicate_in, object_in)
  ON CONFLICT (subject, predicate) DO UPDATE SET
    object = object_in,
    updated = NOW();

END;
$$ LANGUAGE plpgsql;