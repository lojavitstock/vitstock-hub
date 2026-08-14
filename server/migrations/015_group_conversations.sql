ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS is_group BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS group_name TEXT;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS group_avatar_url TEXT;

CREATE INDEX IF NOT EXISTS conversations_company_group_idx
  ON conversations (company_id, is_group, last_message_at DESC);
