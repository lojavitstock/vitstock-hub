-- Persist the operational state of the existing Google Contacts connection.
-- This is additive: disconnecting the integration must not affect local contacts,
-- conversations, messages, tags, or Google-side data.
ALTER TABLE google_connections
  ADD COLUMN IF NOT EXISTS sync_status TEXT NOT NULL DEFAULT 'never',
  ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_sync_imported INTEGER,
  ADD COLUMN IF NOT EXISTS last_sync_total INTEGER,
  ADD COLUMN IF NOT EXISTS last_sync_error TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'google_connections_sync_status_check'
  ) THEN
    ALTER TABLE google_connections
      ADD CONSTRAINT google_connections_sync_status_check
      CHECK (sync_status IN ('never', 'syncing', 'success', 'auth_required', 'error'));
  END IF;
END $$;
