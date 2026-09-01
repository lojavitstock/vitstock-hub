CREATE TABLE IF NOT EXISTS evolution_message_staging (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  evolution_message_id TEXT NOT NULL,
  opaque_jid TEXT NOT NULL,
  provider_message JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_attempt_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  UNIQUE (company_id, evolution_message_id)
);

CREATE INDEX IF NOT EXISTS evolution_message_staging_identity_idx
  ON evolution_message_staging (company_id, opaque_jid);

CREATE INDEX IF NOT EXISTS evolution_message_staging_expiry_idx
  ON evolution_message_staging (expires_at);
