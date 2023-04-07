DO $$ BEGIN
    CREATE INDEX IF NOT EXISTS fin_containment_transactions_fid_idx ON containment_transactions(fedora_id);
EXCEPTION
    WHEN undefined_table THEN null;
END $$;
