CREATE TABLE IF NOT EXISTS conversation_daily_responders (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  evolution_remote_jid TEXT NOT NULL,
  response_date DATE NOT NULL,
  first_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  first_user_name TEXT NOT NULL,
  first_responded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, evolution_remote_jid, response_date)
);

CREATE INDEX IF NOT EXISTS conversation_daily_responders_company_date_idx
  ON conversation_daily_responders (company_id, response_date, first_responded_at);
