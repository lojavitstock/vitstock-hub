-- Contact V1 operational foundation. All additions are additive and preserve
-- the legacy contacts.phone column as the principal display value.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS merged_into_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manual_override JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS contacts_company_archived_idx
  ON contacts (company_id, archived_at, lower(name));

CREATE TABLE IF NOT EXISTS contact_phones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  normalized_phone TEXT NOT NULL,
  label TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('whatsapp', 'google', 'manual', 'system', 'csv/import')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contact_phones_company_normalized_idx
  ON contact_phones (company_id, normalized_phone);
CREATE INDEX IF NOT EXISTS contact_phones_contact_idx
  ON contact_phones (contact_id, is_primary DESC, id);
CREATE UNIQUE INDEX IF NOT EXISTS contact_phones_contact_normalized_unique
  ON contact_phones (contact_id, normalized_phone);

CREATE TABLE IF NOT EXISTS contact_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  normalized_email TEXT NOT NULL,
  label TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('google', 'manual', 'system', 'csv/import')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contact_emails_company_normalized_idx
  ON contact_emails (company_id, normalized_email);
CREATE UNIQUE INDEX IF NOT EXISTS contact_emails_contact_normalized_unique
  ON contact_emails (contact_id, normalized_email);

CREATE TABLE IF NOT EXISTS contact_channel_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  identity TEXT NOT NULL,
  identity_type TEXT NOT NULL DEFAULT 'remote_jid',
  aliases TEXT[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, channel, identity)
);
CREATE INDEX IF NOT EXISTS contact_channel_identities_contact_idx
  ON contact_channel_identities (contact_id, channel);

CREATE TABLE IF NOT EXISTS contact_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#EABB19',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS contact_tags_company_name_unique
  ON contact_tags (company_id, lower(name));

CREATE TABLE IF NOT EXISTS contact_tag_links (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES contact_tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_id, tag_id)
);
CREATE INDEX IF NOT EXISTS contact_tag_links_company_idx
  ON contact_tag_links (company_id, tag_id, contact_id);

CREATE TABLE IF NOT EXISTS contact_duplicate_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contact_a_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  contact_b_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('different', 'merged')),
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (contact_a_id <> contact_b_id),
  UNIQUE (company_id, contact_a_id, contact_b_id)
);

CREATE TABLE IF NOT EXISTS contact_merge_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  target_contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'merged' CHECK (status IN ('merged', 'unmerged')),
  field_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  unmerged_at TIMESTAMPTZ,
  unmerged_by UUID REFERENCES users(id) ON DELETE SET NULL,
  CHECK (source_contact_id <> target_contact_id)
);
CREATE TABLE IF NOT EXISTS contact_merge_conversations (
  merge_id UUID NOT NULL REFERENCES contact_merge_operations(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE RESTRICT,
  original_contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  PRIMARY KEY (merge_id, conversation_id)
);

CREATE TABLE IF NOT EXISTS contact_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  before_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contact_audit_logs_company_created_idx
  ON contact_audit_logs (company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS contact_import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'review' CHECK (status IN ('review', 'running', 'completed', 'partial', 'failed')),
  mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS contact_import_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES contact_import_jobs(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'created', 'updated', 'skipped', 'conflict', 'invalid')),
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  error TEXT,
  UNIQUE (job_id, row_number)
);

-- Existing conversations already carry the authoritative remote identity.
-- Recording it is safe and does not merge or move any thread.
INSERT INTO contact_channel_identities (company_id, contact_id, channel, identity, identity_type)
SELECT c.company_id, c.contact_id, 'whatsapp', c.evolution_remote_jid,
       CASE WHEN c.evolution_remote_jid LIKE '%@lid' THEN 'lid' ELSE 'remote_jid' END
FROM conversations c
WHERE c.evolution_remote_jid IS NOT NULL
ON CONFLICT (company_id, channel, identity) DO NOTHING;

-- Backfill the principal value into the new multivalue tables without changing
-- the legacy contact row or its uniqueness guarantees.
INSERT INTO contact_phones (company_id, contact_id, phone, normalized_phone, is_primary, source)
SELECT c.company_id, c.id, c.phone, regexp_replace(c.phone, '[^0-9]', '', 'g'), true,
       CASE WHEN c.source IN ('whatsapp', 'google', 'manual', 'system', 'csv/import') THEN c.source ELSE 'system' END
FROM contacts c
WHERE NULLIF(regexp_replace(c.phone, '[^0-9]', '', 'g'), '') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM contact_phones p WHERE p.contact_id = c.id AND p.normalized_phone = regexp_replace(c.phone, '[^0-9]', '', 'g'));

INSERT INTO contact_emails (company_id, contact_id, email, normalized_email, is_primary, source)
SELECT c.company_id, c.id, c.email, lower(trim(c.email)), true, 'system'
FROM contacts c
WHERE NULLIF(trim(c.email), '') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM contact_emails e WHERE e.contact_id = c.id AND e.normalized_email = lower(trim(c.email)));
