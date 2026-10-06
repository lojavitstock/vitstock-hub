import { expect, test } from '@playwright/test';
import pg from '../../server/node_modules/pg/lib/index.js';
import { ensureQaBlingConnected } from './productFixtures';

const api = 'http://localhost:3001';
const databaseUrl = 'postgresql://vitstock@127.0.0.1:55432/vitstock_qa';
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('Bling catalog projection syncs complete snapshots and serves normalized search locally', async ({ page }) => {
  test.setTimeout(120_000);
  const marker = await page.request.get(`${api}/api/qa/ready`);
  expect(await marker.json()).toMatchObject({ qaMode: true, database: 'local-only', evolution: 'mock-only', google: 'mock-only' });
  await page.goto('/');
  await page.getByLabel('E-mail').fill(process.env.E2E_EMAIL!);
  await page.getByLabel('Senha').fill(process.env.E2E_PASSWORD!);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/atendimento/);
  await ensureQaBlingConnected(page.request, api);

  const pool = new pg.Pool({ connectionString: databaseUrl });
  const company = (await pool.query('SELECT company_id FROM users WHERE email=$1', [process.env.E2E_EMAIL])).rows[0]?.company_id as string;
  expect(company).toBeTruthy();
  const requestBudget = async () => Number((await pool.query("SELECT requests FROM bling_request_budgets WHERE budget='api'")).rows[0].requests);
  const setScenario = async (scenario: string) => {
    const response = await page.request.post(`${api}/api/qa/bling/scenario`, { data: { scenario } });
    expect(response.status()).toBe(200);
  };

  try {
    await pool.query('DELETE FROM bling_product_catalog_generations WHERE company_id=$1', [company]);
    await setScenario('catalog-multipage');
    let before = await requestBudget();

    await page.goto('/configuracoes?tab=products');
    await page.getByRole('button', { name: 'Adicionar produto', exact: true }).click();
    const initialSearchInput = page.getByLabel('Buscar produto no Bling para importar');
    await expect.poll(requestBudget, { timeout: 20_000 }).toBe(before + 4);
    await initialSearchInput.fill('snow');
    await sleep(300);
    expect(await requestBudget()).toBe(before + 4, 'opening without a snapshot may sync once, but typing alone must not call Bling');
    await page.getByRole('button', { name: 'Buscar no catálogo Bling' }).click();
    await expect(page.getByRole('button', { name: /Shampoo Snow - Vonixx/ })).toBeVisible();
    expect(await requestBudget()).toBe(before + 4, 'submitting against a fresh snapshot must remain local');

    before = await requestBudget();
    const fullSyncResponse = await page.request.post(`${api}/api/integrations/bling/products/catalog-sync`);
    expect(fullSyncResponse.status()).toBe(200, await fullSyncResponse.text());
    const fullSync = await fullSyncResponse.json();
    expect(fullSync).toMatchObject({ products: 205, pages: 4 });
    expect(await requestBudget()).toBe(before + 4);
    const publishedGeneration = fullSync.generationId as string;

    const localSearch = async (q: string) => {
      const response = await page.request.get(`${api}/api/integrations/bling/products?limit=20&q=${encodeURIComponent(q)}`);
      expect(response.status()).toBe(200, await response.text());
      return response.json();
    };
    for (const q of ['snow', 'vonixx', 'snow vonixx', 'vonixx snow', 'shampoo snow', 'snow shampoo vonixx']) {
      const result = await localSearch(q);
      expect(result.data.some((item: { id: string }) => item.id === '910000000000000000'), q).toBe(true);
      expect(result.generationId).toBe(publishedGeneration);
    }
    const accent = await localSearch('ácido');
    expect(accent.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: '910000000000000001' })]));
    const exactSku = await localSearch('VNX-SNOW500');
    expect(exactSku.data[0]?.id).toBe('910000000000000000');
    expect(exactSku.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: '910000000000000002' })]));
    for (const q of ['SNOW500', 'VNX-SNOW']) {
      const partial = await localSearch(q);
      expect(partial.data.some((item: { id: string }) => item.id === '910000000000000000'), q).toBe(false);
    }
    expect((await localSearch('Produto Inativo QA')).data).toEqual([]);

    const searchByType = async (tipo?: string, q = '') => {
      const params = new URLSearchParams({ limit: '20' });
      if (tipo) params.set('tipo', tipo);
      if (q) params.set('q', q);
      const response = await page.request.get(`${api}/api/integrations/bling/products?${params.toString()}`);
      expect(response.status()).toBe(200, await response.text());
      return response.json();
    };
    const typeTotals: Record<string, number> = { T: 205, P: 203, S: 2, E: 1, PS: 200, C: 1, V: 1 };
    for (const [tipo, total] of Object.entries(typeTotals)) {
      expect((await searchByType(tipo)).total, `tipo=${tipo}`).toBe(total);
    }
    expect((await searchByType(undefined)).total, 'omitted tipo defaults to T').toBe(205);
    const composition = await searchByType('E', 'Composição QA');
    expect(composition.data.map((item: { id: string }) => item.id)).toEqual(['910000000000000003']);
    const simpleProduct = await searchByType('PS', 'Shampoo Snow');
    expect(simpleProduct.data.map((item: { id: string }) => item.id)).toContain('910000000000000000');
    expect((await searchByType('PS', 'Variação QA')).total).toBe(0);
    const configurable = await searchByType('C', 'Produto com variações QA');
    expect(configurable.data.map((item: { id: string }) => item.id)).toEqual(['910000000000000006']);
    expect((await searchByType('C', 'Variação QA')).total).toBe(0);
    const variation = await searchByType('V', 'Variação QA');
    expect(variation.data.map((item: { id: string }) => item.id)).toEqual(['910000000000000007']);
    expect((await searchByType('P', 'Serviço QA')).total).toBe(0);
    expect((await searchByType('S', 'Serviço QA')).data.map((item: { id: string }) => item.id))
      .toEqual(expect.arrayContaining(['910000000000000004', '910000000000000005']));
    expect((await searchByType('S', '06 21 22 QA')).data.map((item: { id: string }) => item.id)).toEqual(['910000000000000005']);

    before = await requestBudget();
    const page1Response = await page.request.get(`${api}/api/integrations/bling/products?limit=20&page=1`);
    expect(page1Response.status()).toBe(200);
    const page1 = await page1Response.json();
    const page2Response = await page.request.get(`${api}/api/integrations/bling/products?limit=20&page=2&generationId=${page1.generationId}`);
    expect(page2Response.status()).toBe(200);
    const page2 = await page2Response.json();
    expect(page1.data).toHaveLength(20);
    expect(page2.data).toHaveLength(20);
    expect(new Set([...page1.data, ...page2.data].map((item: { id: string }) => item.id)).size).toBe(40);
    expect(page1.hasMore).toBe(true);
    expect(await requestBudget()).toBe(before, 'search and Load more must remain local when the cache is fresh');

    await setScenario('catalog-fail-page-two');
    const incomplete = await page.request.post(`${api}/api/integrations/bling/products/catalog-sync`);
    expect(incomplete.status()).toBe(502);
    const afterIncomplete = await page.request.get(`${api}/api/integrations/bling/products?limit=20&q=snow`);
    expect((await afterIncomplete.json()).generationId).toBe(publishedGeneration);
    const retainedCount = await pool.query(`SELECT count(*)::int AS count FROM bling_product_catalog_entries
      WHERE company_id=$1 AND generation_id=$2`, [company, publishedGeneration]);
    expect(retainedCount.rows[0].count).toBe(205);

    await setScenario('catalog-inactive-response');
    const invalidActive = await page.request.post(`${api}/api/integrations/bling/products/catalog-sync`);
    expect(invalidActive.status()).toBe(502);
    expect((await page.request.get(`${api}/api/integrations/bling/products?limit=20&q=snow`)).status()).toBe(200);
    expect((await pool.query(`SELECT generation_id FROM bling_product_catalog_generations WHERE company_id=$1 AND status='active'`, [company])).rows[0].generation_id).toBe(publishedGeneration);

    await setScenario('catalog-slow');
    before = await requestBudget();
    const firstSyncPromise = page.request.post(`${api}/api/integrations/bling/products/catalog-sync`);
    let budgetAdvanced = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (await requestBudget() > before) { budgetAdvanced = true; break; }
      await sleep(50);
    }
    expect(budgetAdvanced).toBe(true);

    const lockClient = await pool.connect();
    try {
      const lock = await lockClient.query(`SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired`, [`bling-catalog:${company}`]);
      expect(lock.rows[0].acquired).toBe(false, 'another backend connection must hold the company catalog sync lock');
    } finally { lockClient.release(); }
    const secondSyncPromise = page.request.post(`${api}/api/integrations/bling/products/catalog-sync`);
    const [firstSync, secondSync] = await Promise.all([firstSyncPromise, secondSyncPromise]);
    expect(firstSync.status()).toBe(200);
    expect(secondSync.status()).toBe(200);
    expect((await firstSync.json()).generationId).toBe((await secondSync.json()).generationId);
    expect(await requestBudget()).toBe(before + 4, 'two concurrent requests must share one complete scan');

    await setScenario('catalog-multipage');
    const searchInput = page.getByLabel('Buscar produto no Bling para importar');
    before = await requestBudget();
    await searchInput.fill('snow');
    await sleep(300);
    expect(await requestBudget()).toBe(before, 'typing alone must not call Bling');
    await page.getByRole('button', { name: 'Buscar no catálogo Bling' }).click();
    await expect(page.getByRole('button', { name: /Shampoo Snow - Vonixx/ })).toBeVisible();
    expect(await requestBudget()).toBe(before, 'submitting a fresh local search must not call Bling');
    await page.getByRole('button', { name: 'Atualizar catálogo Bling' }).click();
    await expect.poll(requestBudget).toBe(before + 4);
    await expect(page.getByRole('button', { name: /Shampoo Snow - Vonixx/ })).toBeVisible();
  } finally {
    await setScenario('default');
    const restoredCatalog = await page.request.post(`${api}/api/integrations/bling/products/catalog-sync`);
    expect(restoredCatalog.status()).toBe(200, await restoredCatalog.text());
    await pool.end();
  }
});
