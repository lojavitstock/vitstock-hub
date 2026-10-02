CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  image_object_key TEXT NOT NULL CHECK (length(btrim(image_object_key)) > 0),
  image_mime_type TEXT NOT NULL CHECK (image_mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  image_size_bytes INTEGER NOT NULL CHECK (image_size_bytes BETWEEN 1 AND 1000000),
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT products_company_id_id_unique UNIQUE (company_id, id)
);

CREATE INDEX IF NOT EXISTS products_company_active_name_idx
  ON products (company_id, lower(name), id)
  WHERE archived_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS messages_company_id_id_unique
  ON messages (company_id, id);

CREATE TABLE IF NOT EXISTS message_product_refs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  message_id UUID NOT NULL,
  product_id UUID NOT NULL,
  product_name_snapshot TEXT NOT NULL CHECK (length(btrim(product_name_snapshot)) BETWEEN 1 AND 120),
  product_price_cents_snapshot INTEGER NOT NULL CHECK (product_price_cents_snapshot >= 0),
  product_currency_snapshot CHAR(3) NOT NULL CHECK (product_currency_snapshot = 'BRL'),
  product_image_object_key_snapshot TEXT NOT NULL CHECK (length(btrim(product_image_object_key_snapshot)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT message_product_refs_message_tenant_fk
    FOREIGN KEY (company_id, message_id) REFERENCES messages(company_id, id) ON DELETE CASCADE,
  CONSTRAINT message_product_refs_product_tenant_fk
    FOREIGN KEY (company_id, product_id) REFERENCES products(company_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS message_product_refs_company_message_idx
  ON message_product_refs (company_id, message_id, created_at, id);
