CREATE TABLE IF NOT EXISTS bling_product_catalog_generations (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  generation_id UUID NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('building', 'active', 'retired')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (company_id, generation_id),
  CHECK ((status = 'building' AND completed_at IS NULL) OR (status IN ('active', 'retired') AND completed_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS bling_product_catalog_one_active_generation
  ON bling_product_catalog_generations (company_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS bling_product_catalog_entries (
  company_id UUID NOT NULL,
  generation_id UUID NOT NULL,
  bling_product_id TEXT NOT NULL CHECK (bling_product_id ~ '^[1-9][0-9]{0,19}$'),
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  sku TEXT,
  normalized_sku TEXT,
  product_type TEXT NOT NULL CHECK (product_type IN ('S', 'P', 'N')),
  status TEXT NOT NULL CHECK (status = 'A'),
  product_format TEXT NOT NULL CHECK (product_format IN ('S', 'V', 'E')),
  price NUMERIC,
  parent_product_id TEXT CHECK (parent_product_id IS NULL OR parent_product_id ~ '^[1-9][0-9]{0,19}$'),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, generation_id, bling_product_id),
  FOREIGN KEY (company_id, generation_id)
    REFERENCES bling_product_catalog_generations (company_id, generation_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS bling_product_catalog_name_page_idx
  ON bling_product_catalog_entries (company_id, generation_id, normalized_name, bling_product_id);

CREATE INDEX IF NOT EXISTS bling_product_catalog_sku_exact_idx
  ON bling_product_catalog_entries (company_id, generation_id, normalized_sku)
  WHERE normalized_sku IS NOT NULL;
