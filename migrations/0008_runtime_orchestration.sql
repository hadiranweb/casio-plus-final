ALTER TABLE integration_outbox
  ALTER COLUMN integration_request_id DROP NOT NULL;

ALTER TABLE integration_outbox
  ADD COLUMN IF NOT EXISTS process_run_id UUID REFERENCES flow_runs(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS adapter_result JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'integration_outbox_source_xor'
  ) THEN
    ALTER TABLE integration_outbox
      ADD CONSTRAINT integration_outbox_source_xor CHECK (
        (integration_request_id IS NOT NULL AND process_run_id IS NULL)
        OR (integration_request_id IS NULL AND process_run_id IS NOT NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS integration_outbox_process_run_idx
  ON integration_outbox (process_run_id, status)
  WHERE process_run_id IS NOT NULL;
