import type { APIRequestContext } from '@playwright/test';
import { createRequire } from 'node:module';

const { Pool } = createRequire(import.meta.url)('../../server/node_modules/pg');

export const qaProductPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

let sequence = 0;

export function nextQaBlingProductId(): string {
  sequence += 1;
  return String(Date.now() * 100 + sequence);
}

export async function ensureQaBlingConnected(api: APIRequestContext, apiBase: string) {
  const marker = await api.get(`${apiBase}/api/qa/ready`);
  if (!marker.ok() || !(await marker.json()).qaMode) throw new Error('Product fixtures require isolated QA mode.');
  const status = await api.get(`${apiBase}/api/integrations/bling/status`);
  if ((await status.json()).connected) return;
  const connection = await (await api.post(`${apiBase}/api/integrations/bling/connect`)).json() as { url: string };
  const callback = await api.get(connection.url, { maxRedirects: 0 });
  if (callback.status() !== 302 || !callback.headers()['location']?.includes('bling=connected')) {
    throw new Error('QA Bling fixture authorization did not complete.');
  }
}

export async function importQaProduct(api: APIRequestContext, apiBase: string, input: { blingProductId: string; name: string }) {
  await ensureQaBlingConnected(api, apiBase);
  const response = await api.post(`${apiBase}/api/products/bling-import`, {
    data: {
      ...input,
      imageBase64: qaProductPng,
      imageMimeType: 'image/png',
    },
  });
  if (response.status() !== 201) throw new Error(`QA Bling import failed with HTTP ${response.status()}.`);
  return (await response.json()).product as { id: string; name: string; priceCents: number; [key: string]: unknown };
}

export async function deleteQaProductFixture(api: APIRequestContext, apiBase: string, productId: string) {
  const marker = await api.get(`${apiBase}/api/qa/ready`);
  const environment = marker.ok() ? await marker.json() : null;
  if (!environment?.qaMode || environment.database !== 'local-only') {
    throw new Error('Product fixture cleanup requires the isolated local QA database.');
  }

  const pool = new Pool({ connectionString: 'postgresql://vitstock@127.0.0.1:55432/vitstock_qa' });
  try {
    await pool.query(`DELETE FROM message_product_refs
      WHERE company_id = (SELECT company_id FROM products WHERE id=$1) AND product_id=$1`, [productId]);
    await pool.query('DELETE FROM products WHERE id=$1', [productId]);
  } finally {
    await pool.end();
  }
}
