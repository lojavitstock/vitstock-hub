CREATE TABLE IF NOT EXISTS conversation_statuses (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  evolution_remote_jid TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'resolved')),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, evolution_remote_jid)
);

CREATE INDEX IF NOT EXISTS conversation_statuses_company_status_idx
  ON conversation_statuses (company_id, status);
