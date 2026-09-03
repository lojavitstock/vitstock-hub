CREATE TABLE IF NOT EXISTS quick_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'COMPANY' CHECK (scope IN ('COMPANY', 'USER')),
  shortcut TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  usage_count INTEGER NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT quick_replies_scope_user_check CHECK ((scope = 'COMPANY' AND user_id IS NULL) OR (scope = 'USER' AND user_id IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS quick_replies_company_shortcut_unique
  ON quick_replies (company_id, lower(shortcut))
  WHERE scope = 'COMPANY' AND is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS quick_replies_user_shortcut_unique
  ON quick_replies (company_id, user_id, lower(shortcut))
  WHERE scope = 'USER' AND is_active = true;

CREATE INDEX IF NOT EXISTS quick_replies_visible_order_idx
  ON quick_replies (company_id, is_active, scope, usage_count DESC, position, lower(title));
