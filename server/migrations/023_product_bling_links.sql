CREATE TABLE IF NOT EXISTS product_bling_links (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  product_id UUID NOT NULL,
  bling_product_id TEXT NOT NULL CHECK (bling_product_id ~ '^[1-9][0-9]{0,19}$'),
  bling_parent_product_id TEXT CHECK (bling_parent_product_id IS NULL OR bling_parent_product_id ~ '^[1-9][0-9]{0,19}$'),
  bling_name TEXT NOT NULL CHECK (length(btrim(bling_name)) BETWEEN 1 AND 120),
  bling_code TEXT,
  bling_gtin TEXT,
  bling_unit TEXT,
  bling_price_cents INTEGER NOT NULL CHECK (bling_price_cents >= 0),
  bling_status TEXT NOT NULL CHECK (bling_status IN ('A', 'I')),
  bling_format TEXT NOT NULL CHECK (bling_format IN ('S', 'V', 'E')),
  stock_physical_total NUMERIC,
  stock_virtual_total NUMERIC,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, product_id),
  CONSTRAINT product_bling_links_product_fk
    FOREIGN KEY (company_id, product_id) REFERENCES products(company_id, id) ON DELETE CASCADE,
  CONSTRAINT product_bling_links_bling_id_unique UNIQUE (company_id, bling_product_id)
);

CREATE INDEX IF NOT EXISTS product_bling_links_company_sync_idx
  ON product_bling_links (company_id, last_synced_at DESC, product_id);

CREATE TABLE IF NOT EXISTS product_bling_stock_balances (
  company_id UUID NOT NULL,
  product_id UUID NOT NULL,
  bling_warehouse_id TEXT NOT NULL CHECK (bling_warehouse_id ~ '^[1-9][0-9]{0,19}$'),
  physical_balance NUMERIC,
  virtual_balance NUMERIC,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, product_id, bling_warehouse_id),
  CONSTRAINT product_bling_stock_balances_link_fk
    FOREIGN KEY (company_id, product_id) REFERENCES product_bling_links(company_id, product_id) ON DELETE CASCADE
);
