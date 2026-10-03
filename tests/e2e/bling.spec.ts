import { expect, request, test } from '@playwright/test';
import pg from '../../server/node_modules/pg/lib/index.js';
import { spawnSync } from 'node:child_process';

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
    (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM message_product_refs r) AS refs`)).rows[0];
  const before = await snapshot();
  const errors: string[] = []; const external: string[] = [];
  let linkedProductId: string | null = null;
  let createdProductId: string | null = null;
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
    const localProductResponse = await page.request.post(`${api}/api/products`, {
      data: { name: `Bling Link QA ${Date.now()}`, priceCents: 2800, imageBase64: png, imageMimeType: 'image/png' },
    });
    expect(localProductResponse.status()).toBe(201);
    linkedProductId = (await localProductResponse.json()).product.id;
    createdProductId = linkedProductId;
    const linkResponse = await page.request.post(`${api}/api/products/${linkedProductId}/bling-link`, { data: { blingProductId: '101' } });
    expect(linkResponse.status()).toBe(200);
    expect(await linkResponse.json()).toMatchObject({ link: {
      productId: linkedProductId, blingProductId: '101', blingName: 'Produto Bling QA', blingPriceCents: 1250,
    } });
    expect((await (await page.request.get(`${api}/api/products/bling-links`)).json()).links).toEqual(expect.arrayContaining([
      expect.objectContaining({ productId: linkedProductId, blingProductId: '101' }),
    ]));
    expect((await page.request.delete(`${api}/api/products/${linkedProductId}/bling-link`)).status()).toBe(200);
    linkedProductId = null;
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
      expect((await denied.post(`${api}/api/auth/login`, { data: { email: process.env.E2E_SECOND_EMAIL, password: process.env.E2E_SECOND_PASSWORD } })).status()).toBe(200);
      for (const action of ['connect', 'disconnect']) expect((await denied.post(`${api}/api/integrations/bling/${action}`)).status()).toBe(403);
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
    }
    expect(await snapshot()).toEqual(before);
    expect(external).toEqual([]); expect(errors).toEqual([]);
  } finally {
    if (linkedProductId) await page.request.delete(`${api}/api/products/${linkedProductId}/bling-link`).catch(() => undefined);
    if (createdProductId) await pool.query('DELETE FROM products WHERE id=$1', [createdProductId]).catch(() => undefined);
    await page.request.post(`${api}/api/integrations/bling/disconnect`); await pool.end();
  }
});

test('Bling QA migration is additive, constrained and logically reversible without committing removal', async ({ request }) => {
  expect(await (await request.get(`${api}/api/qa/ready`)).json()).toMatchObject({ qaMode: true });
  const pool = new pg.Pool({ connectionString: 'postgresql://vitstock@127.0.0.1:55432/vitstock_qa' });
  const client = await pool.connect();
  try {
    expect((await client.query("SELECT name FROM schema_migrations WHERE name='022_bling_integration.sql'")).rows).toHaveLength(1);
    const tables = (await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'bling_%' ORDER BY table_name")).rows.map(r => r.table_name);
    expect(tables).toEqual(['bling_connections','bling_oauth_states','bling_request_budgets']);
    expect((await client.query("SELECT constraint_type FROM information_schema.table_constraints WHERE table_name='bling_connections' AND constraint_type='PRIMARY KEY'")).rows).toHaveLength(1);
    await client.query('BEGIN');
    await client.query('DROP TABLE bling_oauth_states, bling_connections, bling_request_budgets');
    await client.query('ROLLBACK');
    expect((await client.query("SELECT to_regclass('bling_connections') AS name")).rows[0].name).toBe('bling_connections');
  } finally { await client.query('ROLLBACK'); client.release(); await pool.end(); }
});
