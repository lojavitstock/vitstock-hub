ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS google_resource_name TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'hub';

CREATE UNIQUE INDEX IF NOT EXISTS contacts_company_google_resource_unique
  ON contacts (company_id, google_resource_name)
  WHERE google_resource_name IS NOT NULL;

CREATE TABLE IF NOT EXISTS google_connections (
  company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  google_email TEXT,
  refresh_token_encrypted TEXT NOT NULL,
  access_token_encrypted TEXT,
  access_token_expires_at TIMESTAMPTZ,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
