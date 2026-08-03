DROP INDEX IF EXISTS contacts_company_google_resource_unique;

CREATE INDEX IF NOT EXISTS contacts_company_google_resource_idx
  ON contacts (company_id, google_resource_name)
  WHERE google_resource_name IS NOT NULL;
