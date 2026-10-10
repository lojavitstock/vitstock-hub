CREATE TABLE IF NOT EXISTS bling_contact_directory_generations (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  generation_id UUID NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('building', 'active', 'retired')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  contact_count INTEGER,
  PRIMARY KEY (company_id, generation_id),
  CHECK (
    (status = 'building' AND completed_at IS NULL AND contact_count IS NULL)
    OR (status IN ('active', 'retired') AND completed_at IS NOT NULL AND contact_count IS NOT NULL AND contact_count >= 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS bling_contact_directory_one_active_generation
  ON bling_contact_directory_generations (company_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS bling_contact_directory_entries (
  company_id UUID NOT NULL,
  generation_id UUID NOT NULL,
  bling_contact_id TEXT NOT NULL CHECK (bling_contact_id ~ '^[1-9][0-9]{0,19}$'),
  name TEXT NOT NULL,
  document TEXT,
  phone TEXT,
  mobile TEXT,
  phone_digits TEXT CHECK (phone_digits IS NULL OR phone_digits ~ '^[0-9]{12,13}$'),
  mobile_digits TEXT CHECK (mobile_digits IS NULL OR mobile_digits ~ '^[0-9]{12,13}$'),
  status TEXT,
  PRIMARY KEY (company_id, generation_id, bling_contact_id),
  FOREIGN KEY (company_id, generation_id)
    REFERENCES bling_contact_directory_generations (company_id, generation_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS bling_contact_directory_phone_idx
  ON bling_contact_directory_entries (company_id, generation_id, phone_digits)
  WHERE phone_digits IS NOT NULL;

CREATE INDEX IF NOT EXISTS bling_contact_directory_mobile_idx
  ON bling_contact_directory_entries (company_id, generation_id, mobile_digits)
  WHERE mobile_digits IS NOT NULL;
