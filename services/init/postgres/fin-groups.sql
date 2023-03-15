CREATE EXTENSION if not exists pg_trgm with schema pg_catalog;
CREATE EXTENSION if not exists btree_gin with schema pg_catalog;

create schema if not exists fin_groups;
set search_path=fin_groups,public;

CREATE TABLE IF NOT EXISTS "group" (
  group_id SERIAL PRIMARY KEY,
  created timestamp NOT NULL DEFAULT NOW(),
  path TEXT NOT NULL,
  UNIQUE(path)
);
CREATE INDEX IF NOT EXISTS group_path_idx ON "group" USING gin (path gin_trgm_ops);