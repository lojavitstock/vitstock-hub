ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS nickname TEXT,
  ADD COLUMN IF NOT EXISTS birthday TEXT,
  ADD COLUMN IF NOT EXISTS company TEXT,
  ADD COLUMN IF NOT EXISTS job_title TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS google_etag TEXT,
  ADD COLUMN IF NOT EXISTS google_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS google_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS contacts_company_google_synced_idx
  ON contacts (company_id, google_synced_at DESC)
  WHERE google_resource_name IS NOT NULL;
