-- Connection metadata only: no products, stock, media or message references.
CREATE TABLE bling_connections (
  company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  access_token_expires_at TIMESTAMPTZ NOT NULL,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE bling_oauth_states (
  state_hash TEXT PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);
CREATE INDEX bling_oauth_states_company ON bling_oauth_states(company_id);
-- Conservative shared budget across all Hub tenants/replicas, including OAuth.
-- External apps using the same Bling account/IP cannot be coordinated by Hub.
CREATE TABLE bling_request_budgets (
  budget TEXT PRIMARY KEY,
  next_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  day DATE NOT NULL DEFAULT CURRENT_DATE,
  requests INTEGER NOT NULL DEFAULT 0 CHECK (requests >= 0)
);
INSERT INTO bling_request_budgets(budget) VALUES ('api'), ('oauth');
