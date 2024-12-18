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


-- hack for notifiying of direct and indirect property updates
CREATE OR REPLACE FUNCTION notify_after_membership_update()
RETURNS TRIGGER AS $$
BEGIN
    IF( TG_OP = 'DELETE' ) THEN
      PERFORM pg_notify('fin_membership_update', 
        json_build_object(
          'property', OLD.property, 
          'fedora_id', OLD.source_id
        )::text
      );
    ELSE 
      PERFORM pg_notify('fin_membership_update', 
        json_build_object(
          'property', NEW.property, 
          'fedora_id', NEW.source_id
        )::text
      );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO
$$BEGIN
  CREATE TRIGGER notify_after_membership_update_trigger
  AFTER INSERT OR UPDATE OR DELETE ON membership
  FOR EACH ROW
  EXECUTE FUNCTION notify_after_membership_update();
EXCEPTION
  WHEN duplicate_object THEN
    -- Handle the exception here
    RAISE NOTICE 'The trigger notify_after_membership_update_trigger already exists.';
END$$;