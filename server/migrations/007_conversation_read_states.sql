CREATE TABLE IF NOT EXISTS conversation_read_states (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  evolution_remote_jid TEXT NOT NULL,
  last_read_message_timestamp BIGINT NOT NULL DEFAULT 0,
  last_read_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, evolution_remote_jid)
);

CREATE INDEX IF NOT EXISTS conversation_read_states_company_updated_idx
  ON conversation_read_states (company_id, updated_at DESC);
