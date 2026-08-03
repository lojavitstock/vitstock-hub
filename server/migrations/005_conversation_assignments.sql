CREATE TABLE IF NOT EXISTS conversation_assignments (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  evolution_remote_jid TEXT NOT NULL,
  assigned_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, evolution_remote_jid)
);

CREATE INDEX IF NOT EXISTS conversation_assignments_user_idx
  ON conversation_assignments (company_id, assigned_user_id);
