DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT conname
    INTO constraint_name
    FROM pg_constraint
   WHERE conrelid = 'semantic_records'::regclass
     AND contype = 'u'
     AND pg_get_constraintdef(oid) = 'UNIQUE (process_run_id)';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE semantic_records DROP CONSTRAINT %I', constraint_name);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS semantic_records_run_created_idx
  ON semantic_records (process_run_id, created_at DESC);
