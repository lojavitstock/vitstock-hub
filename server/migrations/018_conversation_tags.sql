-- Conversation-scoped tags used by the Atendimento inbox filters.
-- Contact tags remain independent and continue serving the Contacts module.
CREATE TABLE IF NOT EXISTS conversation_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#EABB19',
  system_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT conversation_tags_system_key_check CHECK (system_key IS NULL OR system_key IN ('traffic'))
);

CREATE UNIQUE INDEX IF NOT EXISTS conversation_tags_company_name_unique
  ON conversation_tags (company_id, lower(trim(name)));

CREATE UNIQUE INDEX IF NOT EXISTS conversation_tags_company_system_unique
  ON conversation_tags (company_id, system_key)
  WHERE system_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS conversation_tag_links (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES conversation_tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, tag_id)
);

CREATE INDEX IF NOT EXISTS conversation_tag_links_company_tag_idx
  ON conversation_tag_links (company_id, tag_id, conversation_id);

CREATE INDEX IF NOT EXISTS conversation_tag_links_company_conversation_idx
  ON conversation_tag_links (company_id, conversation_id);
