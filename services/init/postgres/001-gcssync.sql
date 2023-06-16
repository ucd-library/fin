create schema if not exists gcssync;
set search_path=gcssync,public;

DO $$ BEGIN
  CREATE TYPE gcssync_direction as enum ('fcrepo-to-gcs', 'gcs-to-fcrepo');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS update_status (
  update_status_id SERIAL PRIMARY KEY,
  updated timestamp NOT NULL DEFAULT NOW(),
  path TEXT NOT NULL,
  direction gcssync_direction NOT NULL,
  gcs_bucket TEXT NOT NULL,
  gcs_path TEXT NOT NULL,
  error TEXT,
  message TEXT,
  event JSONB,
  UNIQUE (path, direction, gcs_bucket)
);
CREATE INDEX IF NOT EXISTS update_status_path_idx ON update_status (path);
CREATE INDEX IF NOT EXISTS update_status_gcs_bucket_idx ON update_status (gcs_bucket);
CREATE INDEX IF NOT EXISTS update_status_gcs_path_idx ON update_status (gcs_path);

CREATE TABLE IF NOT EXISTS disk_cache (
  disk_cache_id SERIAL PRIMARY KEY,
  last_accessed timestamp NOT NULL,
  path TEXT NOT NULL,
  size integer NOT NULL,
  content_type TEXT NOT NULL,
  file_md5 TEXT NOT NULL,
  bucket TEXT NOT NULL,
  UNIQUE (path, bucket)
);
CREATE INDEX IF NOT EXISTS disk_cache_path_idx ON disk_cache (path);
CREATE INDEX IF NOT EXISTS disk_cache_bucket_idx ON disk_cache (bucket);

-- upsert function for disk_cache
CREATE OR REPLACE FUNCTION upsert_disk_cache (
  bucket_in TEXT,
  path_in TEXT, 
  size_in INTEGER, 
  file_md5_in TEXT,
  content_type_in TEXT
) RETURNS void AS $$
DECLARE
  dcid INTEGER;
BEGIN

  SELECT 
    disk_cache_id INTO dcid
  FROM 
    gcssync.disk_cache 
  WHERE 
    path = path_in AND bucket = bucket_in
  FOR UPDATE;

  IF dcid IS NULL THEN
    INSERT INTO gcssync.disk_cache 
      (bucket, path, size, file_md5, content_type, last_accessed)  
    VALUES 
      (bucket_in, path_in, size_in, file_md5_in, content_type_in, NOW());
  ELSE
    UPDATE gcssync.disk_cache SET
      size = size_in,
      file_md5 = file_md5_in,
      content_type = content_type_in,
      last_accessed = NOW()
    WHERE 
      disk_cache_id = dcid;
  END IF;


END;
$$ LANGUAGE plpgsql;