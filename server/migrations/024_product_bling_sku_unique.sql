CREATE UNIQUE INDEX IF NOT EXISTS product_bling_links_company_sku_unique
  ON product_bling_links (company_id, lower(btrim(bling_code)))
  WHERE bling_code IS NOT NULL AND btrim(bling_code) <> '';
