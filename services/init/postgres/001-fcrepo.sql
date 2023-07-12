set search_path=public;

DO $$ BEGIN
    CREATE INDEX IF NOT EXISTS fin_containment_transactions_fid_idx ON containment_transactions(fedora_id);
EXCEPTION
    WHEN undefined_table THEN null;
END $$;

-- hack for removing bad container deletes
CREATE OR REPLACE FUNCTION powerwash_container (
    fedora_id_in TEXT
) RETURNS void AS $$
DECLARE
  fedora_id_wild_in TEXT;
BEGIN

  SELECT t into fedora_id_wild_in FROM concat(fedora_id_in, '/%') as t;

  DELETE FROM search_resource_rdf_type WHERE resource_id IN (
    SELECT id FROM simple_search WHERE fedora_id = fedora_id_in
  );
  
  DELETE FROM simple_search WHERE fedora_id = fedora_id_in;

  DELETE FROM reference WHERE fedora_id = fedora_id_in;

  DELETE FROM membership WHERE subject_id = fedora_id_in;

  DELETE FROM containment WHERE fedora_id = fedora_id_in;

  DELETE FROM search_resource_rdf_type WHERE resource_id IN (
    SELECT id FROM simple_search WHERE fedora_id LIKE fedora_id_wild_in
  );
  
  DELETE FROM simple_search WHERE fedora_id LIKE fedora_id_wild_in;

  DELETE FROM reference WHERE fedora_id like fedora_id_wild_in;

  DELETE FROM membership WHERE subject_id LIKE fedora_id_wild_in;

  DELETE FROM containment WHERE fedora_id LIKE fedora_id_wild_in;

END;
$$ LANGUAGE plpgsql;