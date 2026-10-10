ALTER TABLE product_bling_links
  ADD COLUMN IF NOT EXISTS stock_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stock_sync_attempted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stock_sync_error TEXT;

UPDATE product_bling_links
SET stock_synced_at = COALESCE(stock_synced_at, last_synced_at),
    stock_sync_attempted_at = COALESCE(stock_sync_attempted_at, last_synced_at)
WHERE stock_synced_at IS NULL OR stock_sync_attempted_at IS NULL;
