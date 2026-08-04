CREATE TABLE IF NOT EXISTS whatsapp_contact_names (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, phone)
);

CREATE INDEX IF NOT EXISTS whatsapp_contact_names_company_updated_idx
  ON whatsapp_contact_names (company_id, updated_at DESC);
