import { expect, request, test } from '@playwright/test';
import pg from '../../server/node_modules/pg/lib/index.js';
import { spawnSync } from 'node:child_process';
import { ensureQaBlingConnected, importQaProduct, nextQaBlingProductId } from './productFixtures';

const api = 'http://localhost:3001';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('Bling isolated pool keeps Hub healthy with DB_POOL_MAX=1; replica locks serialize refresh and mixed operations', async () => {
  test.setTimeout(60000);
  const child = spawnSync(process.execPath, ['--import', './server/node_modules/tsx/dist/loader.mjs', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { createQaEnv } from './scripts/qa-env.mjs';
    Object.assign(process.env, createQaEnv(), { DB_POOL_MAX:'1', DB_CONNECTION_TIMEOUT_MS:'8000' });
    const { db } = await import('./server/src/db.ts');
    const { PgBlingStore, stateHash } = await import('./server/src/blingStore.ts');
    const { integrationCipher } = await import('./server/src/blingEncryption.ts');
    const { BlingApiClient } = await import('./server/src/blingClient.ts');
    const { TOKEN_URL, BlingError } = await import('./server/src/blingContract.ts');
    const cipher = integrationCipher(process.env.INTEGRATION_ENCRYPTION_KEY);
    const first = new PgBlingStore(cipher), second = new PgBlingStore(cipher);
    const users = (await db.query("SELECT DISTINCT ON (company_id) id,company_id FROM users WHERE role='admin' ORDER BY company_id,id")).rows;
    assert.ok(users.length >= 2); const a=users[0], b=users[1];
    const token = {access_token:'qa.pool.signature',refresh_token:'qa-local-rotation',token_type:'Bearer',expires_in:21600};
    let refreshes=0, failGet=false, unauthorized=false; const calls=[];
    const transport = async (url, init) => {
      calls.push({url,time:performance.now()});
      if (url === TOKEN_URL) { refreshes++; return Response.json({...token, refresh_token:'qa-local-rotation-'+refreshes}); }
      if (unauthorized) { unauthorized=false; return Response.json({}, {status:401}); }
      return Response.json({data:[]}, {status: failGet ? 403 : 200});
    };
    const credentials={clientId:'qa-local-client',clientSecret:'qa-local-secret',redirectUri:'http://localhost:3001/api/integrations/bling/callback'};
    const clients=[new BlingApiClient(first,credentials,transport),new BlingApiClient(second,credentials,transport)];
    try {
      let enter; const entered=new Promise(r=>enter=r);
      const providerWait=first.locked(a.company_id,async()=>{enter();await new Promise(r=>setTimeout(r,4500));});
      await entered; const start=performance.now(); await db.query('SELECT 1');
      assert.ok(performance.now()-start < 3000, 'Hub health slot must remain available during provider wait');
      await providerWait;
      await first.locked(a.company_id,s=>s.save(token));
      await db.query("UPDATE bling_connections SET access_token_expires_at=now()-interval '1 second' WHERE company_id=$1",[a.company_id]);
      const before=refreshes;
      await Promise.all(Array.from({length:10},(_,i)=>clients[i%2].read(a.company_id,'products',new URLSearchParams())));
      assert.equal(refreshes-before,1,'two replicas must refresh exactly once');
      unauthorized=true; await clients[1].read(a.company_id,'products',new URLSearchParams());
      await db.query("UPDATE bling_connections SET access_token_expires_at=now()-interval '1 second' WHERE company_id=$1",[a.company_id]);
      failGet=true; await assert.rejects(clients[0].read(a.company_id,'products',new URLSearchParams()), e=>e instanceof BlingError && e.statusCode===403);
      const persisted=await second.locked(a.company_id,s=>s.get()); assert.equal(persisted.refresh,'qa-local-rotation-'+refreshes); failGet=false;
      const state=await second.createState(b.company_id,b.id);
      assert.equal(await first.consumeState(state,a.company_id,a.id),false);
      assert.equal(await first.consumeState(state,b.company_id,a.id),false);
      assert.equal(await first.consumeState(state,b.company_id,b.id),true);
      assert.equal(await second.consumeState(state,b.company_id,b.id),false);
      await Promise.all([
        clients[0].read(a.company_id,'products',new URLSearchParams()),
        clients[1].connect(b.company_id,'qa-local-code',stateHash(state)),
      ]);
      await Promise.all([
        first.locked(b.company_id,s=>s.remove()),
        clients[1].read(a.company_id,'products',new URLSearchParams()),
      ]);
      const oauth=calls.filter(v=>v.url===TOKEN_URL);
      for(let i=1;i<oauth.length;i++) assert.ok(oauth[i].time-oauth[i-1].time>=3000,'OAuth window must stay below 20/minute');
      for(let i=3;i<calls.length;i++) assert.ok(calls[i].time-calls[i-3].time>=1000,'at most three Hub calls in any second');
      console.log('POOL_ISOLATION_AND_REPLICA_LOCKS_OK');
    } finally {
      for(const user of [a,b]) await first.locked(user.company_id,s=>s.remove());
      await first.close(); await second.close(); await db.end();
    }
  `], { encoding:'utf8', timeout:55000 });
  expect(child.status, 'isolated PostgreSQL concurrency diagnostic must complete without deadlock').toBe(0);
  expect(child.stdout).toContain('POOL_ISOLATION_AND_REPLICA_LOCKS_OK');
});
test('Bling QA OAuth UI, encrypted persistence, tenant isolation, single-use state and immutable Product Library', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const marker = await page.request.get(`${api}/api/qa/ready`);
  expect(await marker.json()).toMatchObject({ qaMode: true, evolution: 'mock-only', google: 'mock-only' });
  const pool = new pg.Pool({ connectionString: 'postgresql://vitstock@127.0.0.1:55432/vitstock_qa' });
  const snapshot = async () => (await pool.query(`SELECT
    (SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM products p) AS products,
    (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM message_product_refs r) AS refs,
    (SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY company_id,product_id),'[]') FROM product_bling_links l) AS links,
    (SELECT COALESCE(jsonb_agg(to_jsonb(b) ORDER BY company_id,product_id,bling_warehouse_id),'[]') FROM product_bling_stock_balances b) AS balances`)).rows[0];
  const apiBudget = async () => Number((await pool.query("SELECT requests FROM bling_request_budgets WHERE budget='api'")).rows[0].requests);
  const before = await snapshot();
  const errors: string[] = []; const external: string[] = [];
  let linkedProductId: string | null = null;
  let createdProductId: string | null = null;
  let importedProductId: string | null = null;
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (new URL(r.url()).hostname.endsWith('bling.com.br')) external.push(r.url()); });
  try {
    await page.goto('/');
    await page.getByLabel('E-mail').fill(process.env.E2E_EMAIL!);
    await page.getByLabel('Senha').fill(process.env.E2E_PASSWORD!);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/atendimento/);
    await page.request.post(`${api}/api/integrations/bling/disconnect`);
    await page.goto('/configuracoes?tab=integracoes');
    await expect(page.getByTestId('bling-status')).toHaveText('Não conectado');
    await page.getByRole('button', { name: 'Conectar Bling', exact: true }).click();
    await expect(page).toHaveURL(/bling=connected/);
    await expect(page.getByTestId('bling-status')).toHaveText('Conectado');
    await page.locator('section[aria-labelledby="bling-title"]').screenshot({ path: testInfo.outputPath('bling-connected.png') });
    const status = await (await page.request.get(`${api}/api/integrations/bling/status`)).json();
    expect(Object.keys(status).sort()).toEqual(['configured','connected','connectedAt']);
    const connection = (await pool.query('SELECT access_token_encrypted,refresh_token_encrypted FROM bling_connections')).rows;
    expect(connection).toHaveLength(1);
    expect(connection[0].access_token_encrypted).toMatch(/^v1\./);
    expect(connection[0].access_token_encrypted).not.toContain('qa.header.signature');
    expect(connection[0].refresh_token_encrypted).not.toContain('qa-local-refresh');
    for (const path of ['products?page=1&limit=1', 'products/101', 'warehouses', 'products/101/stock', 'products/101/stock?warehouseId=7']) {
      const res = await page.request.get(`${api}/api/integrations/bling/${path}`); expect(res.status()).toBe(200);
      const body = await res.json(); expect(JSON.stringify(body)).not.toMatch(/access_token|refresh_token|client_secret/);
      if (path === 'products/101') expect(body.data.id).toBe('101');
      if (path.startsWith('products/101/stock')) expect(body.data[0]).toMatchObject({ produto: { id: '101' }, saldoFisicoTotal: 8, saldoVirtualTotal: 5 });
    }
    const catalogPage1 = await page.request.get(`${api}/api/integrations/bling/products?page=1&limit=20`);
    expect(catalogPage1.status()).toBe(200);
    const page1Body = await catalogPage1.json();
    expect(page1Body).toMatchObject({ page: 1, limit: 20 });
    expect(page1Body.data).toHaveLength(20);
    expect(page1Body.data.every((product: { situacao: string }) => product.situacao === 'A')).toBe(true);
    const page1Ids = page1Body.data.map((product: { id: string }) => product.id);
    expect(page1Ids).not.toContain('201');
    expect(page1Ids).not.toContain('202');
    const catalogPage2 = await page.request.get(`${api}/api/integrations/bling/products?page=2&limit=20`);
    expect(catalogPage2.status()).toBe(200);
    const page2Body = await catalogPage2.json();
    expect(page2Body).toMatchObject({ page: 2, limit: 20 });
    expect(page2Body.data).toEqual([
      expect.objectContaining({ id: '322', situacao: 'A' }),
      expect.objectContaining({ id: '323', situacao: 'A' }),
    ]);
    const activeSearch = await page.request.get(`${api}/api/integrations/bling/products?page=1&limit=5&nome=${encodeURIComponent('Produto Catálogo QA 322')}`);
    expect((await activeSearch.json()).data).toEqual([expect.objectContaining({ id: '322', situacao: 'A' })]);
    const inactiveSearch = await page.request.get(`${api}/api/integrations/bling/products?page=1&limit=5&nome=${encodeURIComponent('Produto Inativo QA')}`);
    expect((await inactiveSearch.json()).data).toEqual([]);
    const localProductName = `Bling Link QA ${Date.now()}`;
    const localProduct = await importQaProduct(page.request, api, { blingProductId: nextQaBlingProductId(), name: localProductName });
    linkedProductId = localProduct.id;
    createdProductId = linkedProductId;
    const originalImage = (await pool.query('SELECT image_object_key FROM products WHERE id=$1', [linkedProductId])).rows[0].image_object_key;
    const linkedState = async () => (await pool.query(`SELECT to_jsonb(p) AS product,
      (SELECT to_jsonb(l) FROM product_bling_links l WHERE l.company_id=p.company_id AND l.product_id=p.id) AS link,
      (SELECT COALESCE(jsonb_agg(to_jsonb(b) ORDER BY b.bling_warehouse_id),'[]') FROM product_bling_stock_balances b WHERE b.company_id=p.company_id AND b.product_id=p.id) AS balances
      FROM products p WHERE p.id=$1`, [linkedProductId])).rows[0];
    for (const blingProductId of ['201', '202']) {
      const beforeInactiveLink = await linkedState();
      const budgetBefore = await apiBudget();
      const inactiveLink = await page.request.post(`${api}/api/products/${linkedProductId}/bling-link`, { data: { blingProductId } });
      expect(inactiveLink.status()).toBe(409);
      expect(await linkedState()).toEqual(beforeInactiveLink);
      expect(await apiBudget()).toBe(budgetBefore + 1);
    }
    const linkResponse = await page.request.post(`${api}/api/products/${linkedProductId}/bling-link`, { data: { blingProductId: '101' } });
    expect(linkResponse.status()).toBe(200);
    expect(await linkResponse.json()).toMatchObject({ product: {
      id: linkedProductId, source: 'bling', name: localProductName, priceCents: 2800,
      bling: { productId: '101', name: 'Produto Bling QA', code: 'SKU-101', gtin: '7890000000001', unit: 'UN',
        status: 'A', format: 'S', stockPhysicalTotal: '8', stockVirtualTotal: '5' },
    } });
    expect((await pool.query('SELECT image_object_key FROM products WHERE id=$1', [linkedProductId])).rows[0].image_object_key).toBe(originalImage);
    expect((await pool.query('SELECT bling_warehouse_id,physical_balance,virtual_balance FROM product_bling_stock_balances WHERE product_id=$1', [linkedProductId])).rows)
      .toEqual([{ bling_warehouse_id: '7', physical_balance: '8', virtual_balance: '5' }]);
    expect((await (await page.request.get(`${api}/api/products/bling-links`)).json()).links).toEqual(expect.arrayContaining([
      expect.objectContaining({ productId: linkedProductId, blingProductId: '101' }),
    ]));
    const localNameEdit = await page.request.patch(`${api}/api/products/${linkedProductId}`, { data: { name: 'Nome curado no Hub' } });
    expect(localNameEdit.status()).toBe(200);
    expect((await page.request.patch(`${api}/api/products/${linkedProductId}`, { data: { priceCents: 3000 } })).status()).toBe(400);
    const imageEdit = await page.request.patch(`${api}/api/products/${linkedProductId}`, { data: { imageBase64: png, imageMimeType: 'image/png' } });
    expect(imageEdit.status()).toBe(200);
    expect((await imageEdit.json()).product).toMatchObject({ source: 'bling', name: 'Nome curado no Hub', priceCents: 2800 });
    const editedImage = (await pool.query('SELECT image_object_key FROM products WHERE id=$1', [linkedProductId])).rows[0].image_object_key;
    expect(editedImage).not.toBe(originalImage);

    const beforeInvalidSync = await linkedState();
    expect((await page.request.post(`${api}/api/qa/bling/scenario`, { data: { scenario: 'invalid-stock' } })).status()).toBe(200);
    expect((await page.request.post(`${api}/api/products/${linkedProductId}/bling-sync`)).status()).toBe(502);
    expect(await linkedState()).toEqual(beforeInvalidSync);
    expect((await page.request.post(`${api}/api/products/${linkedProductId}/bling-sync`, { data: { blingProductId: '202' } })).status()).toBe(400);
    expect((await page.request.post(`${api}/api/qa/bling/scenario`, { data: { scenario: 'updated' } })).status()).toBe(200);
    const sync = await page.request.post(`${api}/api/products/${linkedProductId}/bling-sync`);
    expect(sync.status()).toBe(200);
    expect((await sync.json()).product).toMatchObject({ name: 'Nome curado no Hub', priceCents: 4000,
      bling: { productId: '101', name: 'Produto Bling Atualizado QA', parentProductId: '90', status: 'I', stockPhysicalTotal: '14.25', stockVirtualTotal: '9' } });
    expect((await pool.query('SELECT image_object_key FROM products WHERE id=$1', [linkedProductId])).rows[0].image_object_key).toBe(editedImage);
    expect((await page.request.post(`${api}/api/qa/bling/scenario`, { data: { scenario: 'default' } })).status()).toBe(200);
    for (const blingProductId of ['201', '202']) {
      const beforeInactiveRelink = await linkedState();
      const budgetBefore = await apiBudget();
      const inactiveRelink = await page.request.post(`${api}/api/products/${linkedProductId}/bling-link`, { data: { blingProductId } });
      expect(inactiveRelink.status()).toBe(409);
      expect(await linkedState()).toEqual(beforeInactiveRelink);
      expect(await apiBudget()).toBe(budgetBefore + 1);
    }
    const relink = await page.request.post(`${api}/api/products/${linkedProductId}/bling-link`, { data: { blingProductId: '304' } });
    expect(relink.status()).toBe(200);
    expect((await relink.json()).product).toMatchObject({ source: 'bling', name: 'Nome curado no Hub', priceCents: 18000, bling: { productId: '304', name: 'Produto Catálogo QA 304' } });
    const beforeUnlink = await linkedState();
    const unlink = await page.request.delete(`${api}/api/products/${linkedProductId}/bling-link`);
    expect(unlink.status()).toBe(409);
    expect(await unlink.json()).toMatchObject({
      code: 'bling_unlink_prohibited',
      error: 'Produtos do Hub precisam permanecer vinculados ao Bling. Altere o produto Bling ou arquive o cadastro.',
    });
    expect(await linkedState()).toEqual(beforeUnlink);

    const productCountBeforeFailedImport = Number((await pool.query('SELECT count(*)::int AS count FROM products')).rows[0].count);
    const beforeInactiveImports = await snapshot();
    for (const blingProductId of ['201', '202']) {
      const budgetBefore = await apiBudget();
      const inactiveImport = await page.request.post(`${api}/api/products/bling-import`, {
        data: { blingProductId, name: `Inactive ${blingProductId}`, imageBase64: png, imageMimeType: 'image/png' },
      });
      expect(inactiveImport.status()).toBe(409);
      expect(await snapshot()).toEqual(beforeInactiveImports);
      expect(await apiBudget()).toBe(budgetBefore + 1);
    }
    const importBody = { blingProductId: '303', name: 'Nome local do produto importado', imageBase64: png, imageMimeType: 'image/png' };
    const imported = await page.request.post(`${api}/api/products/bling-import`, { data: importBody });
    expect(imported.status()).toBe(201);
    const importedProduct = (await imported.json()).product;
    importedProductId = importedProduct.id;
    expect(importedProduct).toMatchObject({ source: 'bling', name: importBody.name, priceCents: 18000,
      bling: { productId: '303', name: 'Produto para Importar QA', code: 'SKU-303', unit: 'UN', status: 'A', format: 'S' } });
    expect((await page.request.post(`${api}/api/products/bling-import`, { data: importBody })).status()).toBe(409);
    expect((await page.request.get(`${api}/api/products/${importedProductId}`)).status()).toBe(200);
    const importedImageKey = (await pool.query('SELECT image_object_key FROM products WHERE id=$1', [importedProductId])).rows[0].image_object_key;
    expect(importedImageKey).toMatch(new RegExp(`^products/.+/${importedProductId}/.+\\.png$`));
    const listWithEndedProduct = await page.request.get(`${api}/api/integrations/bling/products?page=1&limit=20`);
    expect(listWithEndedProduct.status()).toBe(200);
    expect((await listWithEndedProduct.json()).data.every((product: { situacao: string }) => product.situacao === 'A')).toBe(true);
    const listedIds = (await listWithEndedProduct.json()).data.map((product: { id: string }) => product.id);
    expect(listedIds).not.toContain('201');
    expect(listedIds).not.toContain('202');
    const endedDetail = await page.request.get(`${api}/api/integrations/bling/products/202`);
    expect(endedDetail.status()).toBe(502);

    expect((await page.request.post(`${api}/api/qa/bling/scenario`, { data: { scenario: 'missing-price' } })).status()).toBe(200);
    const missingPriceImport = await page.request.post(`${api}/api/products/bling-import`, { data: { ...importBody, blingProductId: '101' } });
    expect(missingPriceImport.status()).toBe(502);
    expect(Number((await pool.query('SELECT count(*)::int AS count FROM products')).rows[0].count)).toBe(productCountBeforeFailedImport + 1);
    expect((await page.request.post(`${api}/api/qa/bling/scenario`, { data: { scenario: 'default' } })).status()).toBe(200);
    expect((await page.request.get(`${api}/api/integrations/bling/products?url=https://evil.example`)).status()).toBe(400);
    expect((await page.request.get(`${api}/api/integrations/bling/products?limit=101`)).status()).toBe(400);
    const oauthBefore = Number((await pool.query("SELECT requests FROM bling_request_budgets WHERE budget='oauth'")).rows[0].requests);
    await pool.query("UPDATE bling_connections SET access_token_expires_at=now()-interval '1 second'");
    const concurrent = await Promise.all(Array.from({ length: 10 }, () => page.request.get(`${api}/api/integrations/bling/products`)));
    expect(concurrent.map(r => r.status())).toEqual(Array(10).fill(200));
    const oauthAfter = Number((await pool.query("SELECT requests FROM bling_request_budgets WHERE budget='oauth'")).rows[0].requests);
    expect(oauthAfter - oauthBefore).toBe(1);
    const second = await request.newContext();
    try {
      expect((await second.post(`${api}/api/auth/login`, { data: { email: 'qa-admin-b@vitstock.test', password: process.env.E2E_PASSWORD } })).status()).toBe(200);
      expect((await (await second.get(`${api}/api/integrations/bling/status`)).json()).connected).toBe(false);
      expect((await second.get(`${api}/api/integrations/bling/products`)).status()).toBe(409);
      expect((await second.get(`${api}/api/products/${importedProductId}`)).status()).toBe(404);
    } finally { await second.dispose(); }
    const connect = await (await page.request.post(`${api}/api/integrations/bling/connect`)).json();
    expect((await page.request.get(connect.url, { maxRedirects: 0 })).headers().location).toContain('bling=connected');
    expect((await page.request.get(connect.url, { maxRedirects: 0 })).headers().location).toContain('bling=error');
    const expired = await (await page.request.post(`${api}/api/integrations/bling/connect`)).json();
    await pool.query("UPDATE bling_oauth_states SET expires_at=now()-interval '1 second'");
    expect((await page.request.get(expired.url, { maxRedirects: 0 })).headers().location).toContain('bling=error');
    const missingCode = new URL((await (await page.request.post(`${api}/api/integrations/bling/connect`)).json()).url);
    missingCode.searchParams.delete('code');
    expect((await page.request.get(missingCode.href, { maxRedirects: 0 })).headers().location).toContain('bling=error');
    const denied = await request.newContext();
    try {
      const attendantLogin = await denied.post(`${api}/api/auth/login`, { data: { email: process.env.E2E_SECOND_EMAIL, password: process.env.E2E_SECOND_PASSWORD } });
      expect(attendantLogin.status()).toBe(200);
      expect((await attendantLogin.json()).user.role).toBe('attendant');
      expect((await denied.get(`${api}/api/integrations/bling/status`)).status()).toBe(200);
      const apiBudgetBeforeAttendantReads = Number((await pool.query("SELECT requests FROM bling_request_budgets WHERE budget='api'")).rows[0].requests);
      const upstreamReads = await Promise.all([
        denied.get(`${api}/api/integrations/bling/products`),
        denied.get(`${api}/api/integrations/bling/products/101`),
        denied.get(`${api}/api/integrations/bling/products/101/stock`),
        denied.get(`${api}/api/integrations/bling/warehouses`),
      ]);
      expect(upstreamReads.map(response => response.status())).toEqual([403, 403, 403, 403]);
      const apiBudgetAfterAttendantReads = Number((await pool.query("SELECT requests FROM bling_request_budgets WHERE budget='api'")).rows[0].requests);
      expect(apiBudgetAfterAttendantReads).toBe(apiBudgetBeforeAttendantReads);
      const localProductsResponse = await denied.get(`${api}/api/products`);
      expect(localProductsResponse.status()).toBe(200);
      expect((await localProductsResponse.json()).products).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: importedProductId, source: 'bling', bling: expect.objectContaining({ productId: '303' }) }),
      ]));
      for (const action of ['connect', 'disconnect']) expect((await denied.post(`${api}/api/integrations/bling/${action}`)).status()).toBe(403);
      expect((await denied.post(`${api}/api/products/${importedProductId}/bling-sync`)).status()).toBe(403);
      expect((await denied.delete(`${api}/api/products/${importedProductId}/bling-link`)).status()).toBe(403);
    } finally { await denied.dispose(); }
    // Exhaust only the Bling QA budget, prove fail-closed, then restore test state.
    const budget = (await pool.query("SELECT requests,day FROM bling_request_budgets WHERE budget='api'")).rows[0];
    try {
      await pool.query("UPDATE bling_request_budgets SET requests=120000,day=CURRENT_DATE WHERE budget='api'");
      expect((await page.request.get(`${api}/api/integrations/bling/products`)).status()).toBe(429);
    } finally { await pool.query("UPDATE bling_request_budgets SET requests=$1,day=$2 WHERE budget='api'", [budget.requests,budget.day]); }
    expect((await page.request.get(`${api}/api/integrations/bling/callback?state=${'a'.repeat(43)}&code=qa-local-code`, { maxRedirects: 0 })).headers().location).toContain('bling=error');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Desconectar Bling', exact: true }).click();
    await expect(page.getByTestId('bling-status')).toHaveText('Não conectado');
    if (createdProductId) {
      await pool.query('DELETE FROM products WHERE id=$1', [createdProductId]);
      createdProductId = null;
      linkedProductId = null;
    }
    if (importedProductId) {
      await pool.query('DELETE FROM products WHERE id=$1', [importedProductId]);
      importedProductId = null;
    }
    expect(await snapshot()).toEqual(before);
    expect(external).toEqual([]); expect(errors).toEqual([]);
  } finally {
    if (createdProductId) await pool.query('DELETE FROM products WHERE id=$1', [createdProductId]).catch(() => undefined);
    if (importedProductId) await pool.query('DELETE FROM products WHERE id=$1', [importedProductId]).catch(() => undefined);
    await page.request.post(`${api}/api/qa/bling/scenario`, { data: { scenario: 'default' } }).catch(() => undefined);
    await page.request.post(`${api}/api/integrations/bling/disconnect`); await pool.end();
  }
});

test('SKU normalization, failed link/sync atomicity and effective stock rules', async ({ page }) => {
  test.setTimeout(90_000);
  expect((await (await page.request.get(`${api}/api/qa/ready`)).json()).qaMode).toBe(true);
  expect((await page.request.post(`${api}/api/auth/login`, {
    data: { email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD },
  })).status()).toBe(200);
  await ensureQaBlingConnected(page.request, api);
  const pool = new pg.Pool({ connectionString: 'postgresql://vitstock@127.0.0.1:55432/vitstock_qa' });
  const createdIds: string[] = [];
  const nextId = () => nextQaBlingProductId();
  const importProduct = async (providerId: string, name: string) => {
    const response = await page.request.post(`${api}/api/products/bling-import`, { data: {
      blingProductId: providerId, name, imageBase64: png, imageMimeType: 'image/png',
    } });
    return response;
  };
  const state = async (productId: string) => (await pool.query(`SELECT to_jsonb(p) AS product,
    (SELECT to_jsonb(l) FROM product_bling_links l WHERE l.company_id=p.company_id AND l.product_id=p.id) AS link,
    (SELECT COALESCE(jsonb_agg(to_jsonb(b) ORDER BY b.bling_warehouse_id),'[]') FROM product_bling_stock_balances b WHERE b.company_id=p.company_id AND b.product_id=p.id) AS balances
    FROM products p WHERE p.id=$1`, [productId])).rows[0];
  const productCount = async () => Number((await pool.query('SELECT count(*)::int AS count FROM products')).rows[0].count);
  try {
    const existingSkuProduct = await importQaProduct(page.request, api, { blingProductId: nextId(), name: 'SKU 101 base QA' });
    createdIds.push(existingSkuProduct.id);
    const establishSku101 = await page.request.post(`${api}/api/products/${existingSkuProduct.id}/bling-link`, { data: { blingProductId: '101' } });
    expect(establishSku101.status()).toBe(200);

    const linkCandidate = await importQaProduct(page.request, api, { blingProductId: nextId(), name: 'SKU link candidate QA' });
    createdIds.push(linkCandidate.id);
    const relinkCandidate = await importQaProduct(page.request, api, { blingProductId: nextId(), name: 'SKU relink candidate QA' });
    createdIds.push(relinkCandidate.id);
    const syncCandidate = await importQaProduct(page.request, api, { blingProductId: nextId(), name: 'SKU sync candidate QA' });
    createdIds.push(syncCandidate.id);

    const countBeforeDuplicate = await productCount();
    expect((await page.request.post(`${api}/api/qa/bling/scenario`, { data: { scenario: 'sku-collision' } })).status()).toBe(200);
    const duplicateImport = await importProduct(nextId(), 'Duplicate SKU import QA');
    expect(duplicateImport.status()).toBe(409);
    expect((await duplicateImport.json()).error).toBe('Já existe um produto cadastrado no Hub com este SKU.');
    expect(await productCount()).toBe(countBeforeDuplicate);

    const linkBefore = await state(linkCandidate.id);
    const duplicateLink = await page.request.post(`${api}/api/products/${linkCandidate.id}/bling-link`, { data: { blingProductId: nextId() } });
    expect(duplicateLink.status()).toBe(409);
    expect((await duplicateLink.json()).error).toBe('Já existe um produto cadastrado no Hub com este SKU.');
    expect(await state(linkCandidate.id)).toEqual(linkBefore);

    const relinkBefore = await state(relinkCandidate.id);
    const duplicateRelink = await page.request.post(`${api}/api/products/${relinkCandidate.id}/bling-link`, { data: { blingProductId: nextId() } });
    expect(duplicateRelink.status()).toBe(409);
    expect(await state(relinkCandidate.id)).toEqual(relinkBefore);

    const syncBefore = await state(syncCandidate.id);
    const duplicateSync = await page.request.post(`${api}/api/products/${syncCandidate.id}/bling-sync`);
    expect(duplicateSync.status()).toBe(409);
    expect(await state(syncCandidate.id)).toEqual(syncBefore);

    for (const scenario of ['missing-sku', 'blank-sku'] as const) {
      expect((await page.request.post(`${api}/api/qa/bling/scenario`, { data: { scenario } })).status()).toBe(200);
      const countBefore = await productCount();
      const failedImport = await importProduct(nextId(), `SKU ${scenario} import QA`);
      expect(failedImport.status()).toBe(409);
      expect((await failedImport.json()).error).toBe('Este produto não possui SKU no Bling. Adicione um SKU no Bling e tente novamente.');
      expect(await productCount()).toBe(countBefore);

      const missingLinkBefore = await state(linkCandidate.id);
      expect((await page.request.post(`${api}/api/products/${linkCandidate.id}/bling-link`, { data: { blingProductId: nextId() } })).status()).toBe(409);
      expect(await state(linkCandidate.id)).toEqual(missingLinkBefore);
      const missingRelinkBefore = await state(relinkCandidate.id);
      expect((await page.request.post(`${api}/api/products/${relinkCandidate.id}/bling-link`, { data: { blingProductId: nextId() } })).status()).toBe(409);
      expect(await state(relinkCandidate.id)).toEqual(missingRelinkBefore);
    }

    expect((await page.request.post(`${api}/api/qa/bling/scenario`, { data: { scenario: 'empty-stock' } })).status()).toBe(200);
    const unavailableStockImport = await importProduct(nextId(), 'Unavailable stock import QA');
    expect(unavailableStockImport.status()).toBe(409);
    expect((await unavailableStockImport.json()).error).toBe('Não foi possível obter o estoque deste produto no Bling.');
    const unavailableSyncBefore = await state(syncCandidate.id);
    expect((await page.request.post(`${api}/api/products/${syncCandidate.id}/bling-sync`)).status()).toBe(409);
    expect(await state(syncCandidate.id)).toEqual(unavailableSyncBefore);

    for (const [scenario, expected] of [
      ['physical-only', { stockPhysicalTotal: '7', stockVirtualTotal: null }],
      ['virtual-zero', { stockPhysicalTotal: '8', stockVirtualTotal: '0' }],
      ['virtual-negative', { stockPhysicalTotal: '8', stockVirtualTotal: '-2' }],
    ] as const) {
      expect((await page.request.post(`${api}/api/qa/bling/scenario`, { data: { scenario } })).status()).toBe(200);
      const imported = await importProduct(nextId(), `Stock ${scenario} QA`);
      expect(imported.status()).toBe(201);
      const productId = (await imported.json()).product.id as string;
      createdIds.push(productId);
      const details = await page.request.get(`${api}/api/products/${productId}`);
      expect((await details.json()).product.bling).toMatchObject(expected);
    }
  } finally {
    await page.request.post(`${api}/api/qa/bling/scenario`, { data: { scenario: 'default' } }).catch(() => undefined);
    for (const productId of createdIds) await pool.query('DELETE FROM products WHERE id=$1', [productId]).catch(() => undefined);
    await pool.end();
  }
});

test('Bling QA migration is additive, constrained and logically reversible without committing removal', async ({ request }) => {
  expect(await (await request.get(`${api}/api/qa/ready`)).json()).toMatchObject({ qaMode: true });
  const pool = new pg.Pool({ connectionString: 'postgresql://vitstock@127.0.0.1:55432/vitstock_qa' });
  const client = await pool.connect();
  try {
    expect((await client.query("SELECT name FROM schema_migrations WHERE name='022_bling_integration.sql'")).rows).toHaveLength(1);
    expect((await client.query("SELECT name FROM schema_migrations WHERE name='023_product_bling_links.sql'")).rows).toHaveLength(1);
    expect((await client.query("SELECT name FROM schema_migrations WHERE name='024_product_bling_sku_unique.sql'")).rows).toHaveLength(1);
    const tables = (await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'bling_%' ORDER BY table_name")).rows.map(r => r.table_name);
    expect(tables).toEqual(['bling_connections','bling_oauth_states','bling_request_budgets']);
    const productTables = (await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('product_bling_links','product_bling_stock_balances') ORDER BY table_name")).rows.map(r => r.table_name);
    expect(productTables).toEqual(['product_bling_links','product_bling_stock_balances']);
    const stockTypes = (await client.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_name='product_bling_stock_balances' AND column_name IN ('physical_balance','virtual_balance') ORDER BY column_name")).rows;
    expect(stockTypes).toEqual([{ column_name: 'physical_balance', data_type: 'numeric' }, { column_name: 'virtual_balance', data_type: 'numeric' }]);
    expect((await client.query("SELECT constraint_name FROM information_schema.table_constraints WHERE table_name='product_bling_links' AND constraint_type='UNIQUE'")).rows).toEqual(expect.arrayContaining([{ constraint_name: 'product_bling_links_bling_id_unique' }]));
    const skuIndex = (await client.query("SELECT indexdef FROM pg_indexes WHERE indexname='product_bling_links_company_sku_unique'")).rows[0]?.indexdef as string;
    expect(skuIndex).toMatch(/UNIQUE INDEX.*\(company_id, lower\(btrim\(bling_code\)\)\)/i);
    expect(skuIndex).toMatch(/WHERE .*bling_code IS NOT NULL.*btrim\(bling_code\).*<>\s+''/i);
    expect((await client.query("SELECT constraint_type FROM information_schema.table_constraints WHERE table_name='bling_connections' AND constraint_type='PRIMARY KEY'")).rows).toHaveLength(1);
    await client.query('BEGIN');
    await client.query('DROP TABLE bling_oauth_states, bling_connections, bling_request_budgets');
    await client.query('ROLLBACK');
    expect((await client.query("SELECT to_regclass('bling_connections') AS name")).rows[0].name).toBe('bling_connections');
  } finally { await client.query('ROLLBACK'); client.release(); await pool.end(); }
});
