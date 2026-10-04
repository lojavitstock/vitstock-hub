ALTER TABLE product_bling_links
  DROP CONSTRAINT IF EXISTS product_bling_links_bling_status_check;

ALTER TABLE product_bling_links
  ADD CONSTRAINT product_bling_links_bling_status_check
  CHECK (bling_status IN ('A', 'I', 'E'));
