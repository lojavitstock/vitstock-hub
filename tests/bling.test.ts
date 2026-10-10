import { strict as assert } from 'node:assert';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { integrationCipher } from '../server/src/blingEncryption.js';
import { API_BASE, TOKEN_URL, AUTHORIZATION_URL, pagination, productListModel, productDetailModel, warehouseModel, stockModel, parseContract, BlingError } from '../server/src/blingContract.js';
import { BlingApiClient, retryAfterMs, type BlingTransport } from '../server/src/blingClient.js';
import { blingPhoneMatches, normalizeBlingLookupPhone } from '../server/src/blingContactLookup.js';
import { formatBlingDocument, formatBlingZipCode, googleMapsSearchUrl } from '../src/utils/blingContactDisplay.js';
import type { BlingSession, BlingStore, Connection } from '../server/src/blingStore.js';

const credentials = { clientId: 'fake-client', clientSecret: 'secret-not-loggable', redirectUri: 'https://api.example.test/api/integrations/bling/callback' };
const tokens = { access_token: 'jwt.new.signature', refresh_token: 'refresh-private', token_type: 'Bearer', expires_in: 21600 };
const json = (value: unknown, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });
class MemoryStore implements BlingStore {
  rows = new Map<string, Connection>(); states = new Map<string, { company: string; user: string; expires: number; used: boolean }>();
  locks = new Map<string, Promise<void>>(); saves = 0; budgets: string[] = [];
  async status(company: string) { return { connected: this.rows.has(company), connectedAt: this.rows.get(company)?.connectedAt ?? null }; }
  async createState(company: string, user: string) {
    const state = randomBytes(32).toString('base64url');
    this.states.set(state, { company, user, expires: Date.now() + 300000, used: false }); return state;
  }
  async consumeState(state: string, company: string, user: string) {
    const value = this.states.get(state);
    if (!value || value.company !== company || value.user !== user || value.used || value.expires <= Date.now()) return false;
    value.used = true; return true;
  }
  async locked<T>(company: string, action: (s: BlingSession) => Promise<T>) {
    const previous = this.locks.get(company) ?? Promise.resolve();
    let unlock!: () => void;
    const next = new Promise<void>(r => { unlock = r; }); this.locks.set(company, next);
    await previous;
    try { return await action({
      get: async () => this.rows.get(company) ?? null,
      save: async v => { this.saves++; this.rows.set(company, { access: v.access_token, refresh: v.refresh_token, expires: Date.now() + v.expires_in * 1000, connectedAt: '2026-10-03T00:00:00.000Z' }); },
      remove: async () => { this.rows.delete(company); for (const [k,v] of this.states) if (v.company === company) this.states.delete(k); },
      validState: async () => [...this.states.values()].some(v => v.company === company && v.used),
      budget: async kind => { this.budgets.push(kind); },
      cooldown: async () => {},
    }); } finally { unlock(); }
  }
}
function setup(transport: BlingTransport, expired = false, timeout = 30) {
  const store = new MemoryStore();
  store.rows.set('A', { access: 'jwt.old.signature', refresh: 'refresh-old', expires: Date.now() + (expired ? -1 : 3600000), connectedAt: 'today' });
  const sleeps: number[] = [];
  const client = new BlingApiClient(store, credentials, transport, async ms => { sleeps.push(ms); }, Date.now, timeout);
  return { client, store, sleeps, read: () => client.read('A', 'products', new URLSearchParams({ pagina: '1', limite: '50' })) };
}

test('Bling encryption: independent key, randomized authenticated ciphertext and tenant/kind binding', () => {
  const cipher = integrationCipher(randomBytes(32).toString('base64'));
  const encrypted = cipher.encrypt('private-access', 'A', 'access');
  assert.ok(!encrypted.includes('private-access')); assert.notEqual(encrypted, cipher.encrypt('private-access', 'A', 'access'));
  assert.equal(cipher.decrypt(encrypted, 'A', 'access'), 'private-access');
  assert.throws(() => cipher.decrypt(encrypted, 'B', 'access')); assert.throws(() => cipher.decrypt(encrypted, 'A', 'refresh'));
  assert.throws(() => cipher.decrypt(encrypted.slice(0, -4) + 'bad', 'A', 'access'));
  assert.throws(() => integrationCipher('SESSION_SECRET'));
  assert.throws(() => integrationCipher(randomBytes(31).toString('base64')));
  assert.throws(() => integrationCipher(randomBytes(32).toString('base64')+'\n'));
  assert.throws(() => integrationCipher(randomBytes(32).toString('base64')).decrypt(encrypted, 'A', 'access'), /reconecte/);
});
test('Bling official destination, JWT headers, GET only and safe parameters', async () => {
  const { read, client } = setup(async (url, init) => {
    assert.equal(url, `${API_BASE}/produtos?pagina=1&limite=50`); assert.equal(init.method, 'GET');
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer jwt.old.signature');
    assert.equal(new Headers(init.headers).get('enable-jwt'), '1'); assert.equal(init.redirect, 'error');
    return json({ data: [] });
  });
  await read();
  await assert.rejects(client.read('A', 'product', new URLSearchParams(), '../oauth'), /Identificador/);
  await assert.rejects(client.read('A', 'https://evil.example' as any, new URLSearchParams()), /Recurso/);
  assert.equal(AUTHORIZATION_URL, 'https://bling.com.br/Api/v3/oauth/authorize');
});
test('Bling expired token: concurrent requests single-flight, rotated tokens persist with proper OAuth headers', async () => {
  let refreshes = 0;
  const { store, read } = setup(async (url, init) => {
    if (url === TOKEN_URL) {
      refreshes++; assert.equal(init.method, 'POST'); assert.equal(new Headers(init.headers).get('enable-jwt'), '1');
      assert.equal(new Headers(init.headers).get('Authorization'), `Basic ${Buffer.from('fake-client:secret-not-loggable').toString('base64')}`);
      assert.equal(new URLSearchParams(String(init.body)).get('refresh_token'), 'refresh-old');
      return json(tokens);
    }
    assert.equal(new Headers(init.headers).get('Authorization'), `Bearer ${tokens.access_token}`);
    return json({ data: [] });
  }, true);
  await Promise.all(Array.from({ length: 10 }, () => read()));
  assert.equal(refreshes, 1); assert.equal(store.saves, 1); assert.equal(store.rows.get('A')?.refresh, tokens.refresh_token);
  assert.equal(store.budgets.filter(v => v === 'oauth').length, 1);
});
test('Bling near-expiry refreshes before GET', async () => {
  let refreshes = 0;
  const { read, store } = setup(async url => url === TOKEN_URL ? (refreshes++, json(tokens)) : json({ data: [] }));
  store.rows.get('A')!.expires = Date.now() + 59000;
  await read(); assert.equal(refreshes, 1);
});

test('Bling authorization-code exchange sends only the documented body fields', async () => {
  const store = new MemoryStore();
  const state = await store.createState('A', 'user');
  await store.consumeState(state, 'A', 'user');
  let calls = 0;
  const client = new BlingApiClient(store, credentials, async (url, init) => {
    calls++; assert.equal(url, TOKEN_URL);
    assert.deepEqual(Object.fromEntries(new URLSearchParams(String(init.body))), { grant_type: 'authorization_code', code: 'fake-code' });
    assert.equal(new Headers(init.headers).get('enable-jwt'), '1');
    assert.equal(new Headers(init.headers).get('Authorization'), `Basic ${Buffer.from('fake-client:secret-not-loggable').toString('base64')}`);
    return json(tokens);
  });
  await client.connect('A', 'fake-code', state); assert.equal(calls, 1);
});
test('Bling 401 refresh once then retry, repeated 401 fails without loop', async () => {
  for (const always401 of [false, true]) {
    let gets = 0, refreshes = 0;
    const { read } = setup(async url => url === TOKEN_URL ? (refreshes++, json(tokens)) : json({ data: [] }, ++gets === 1 || always401 ? 401 : 200));
    if (always401) await assert.rejects(read(), /Reconecte/); else await read();
    assert.equal(gets, 2); assert.equal(refreshes, 1);
  }
});
test('Bling refresh failure preserves old credential, sanitized errors, no POST retry', async () => {
  let calls = 0;
  const { store, read } = setup(async () => { calls++; return json({ error: 'refresh-old secret-not-loggable access_token' }, 400); }, true);
  await assert.rejects(read(), e => e instanceof BlingError && !/refresh-old|secret-not-loggable|access_token/.test(e.message));
  assert.equal(store.rows.get('A')?.refresh, 'refresh-old'); assert.equal(store.saves, 0); assert.equal(calls, 1);
});
test('Bling successful refresh is preserved when downstream GET fails', async () => {
  const { store, read } = setup(async url => url === TOKEN_URL ? json(tokens) : json({}, 403), true);
  await assert.rejects(read()); assert.equal(store.rows.get('A')?.refresh, tokens.refresh_token);
});
test('Bling rejects opaque tokens and incomplete token contract without saving', async () => {
  for (const value of [{ ...tokens, access_token: 'opaque' }, { ...tokens, refresh_token: undefined }]) {
    const { read, store } = setup(async () => json(value), true);
    await assert.rejects(read()); assert.equal(store.saves, 0);
  }
});
test('Bling retry: 429 Retry-After, 5xx, network bounded; normal 4xx never retried', async () => {
  for (const scenario of ['429', '503', 'network', '403']) {
    let calls = 0;
    const { read, sleeps } = setup(async () => { calls++; if (scenario === 'network') throw new Error('private-body'); return json({}, Number(scenario), { 'Retry-After': '1' }); });
    await assert.rejects(read()); assert.equal(calls, scenario === '403' ? 1 : 3);
    if (scenario === '429') assert.deepEqual(sleeps, [1000,1000]);
  }
});
test('Bling long Retry-After exits instead of retrying too early; HTTP date supported', async () => {
  let calls = 0; const { read, sleeps } = setup(async () => { calls++; return json({}, 429, { 'Retry-After': '3600' }); });
  await assert.rejects(read()); assert.equal(calls, 1); assert.deepEqual(sleeps, []);
  assert.equal(retryAfterMs('Thu, 01 Jan 1970 00:00:05 GMT', 0), 5000); assert.equal(retryAfterMs('invalid'), null);
});
test('Bling timeout, including delayed body, is bounded without leaking response', async () => {
  const { read } = setup(async (_url, init) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new Error('secret-not-loggable')))), false, 5);
  await assert.rejects(read(), /tempo/);
  const slow = setup(async () => new Response(new ReadableStream({ start() {} })), false, 5);
  await assert.rejects(slow.read(), /tempo/);
  const oversized = setup(async () => new Response('x'.repeat(5*1024*1024+1)), false, 1000);
  await assert.rejects(oversized.read(), /tempo/);
});
test('Bling invalid JSON and upstream model errors sanitized without retries', async () => {
  let calls = 0; const { read } = setup(async () => { calls++; return new Response('private-token'); });
  await assert.rejects(read(), /Resposta do Bling inválida/); assert.equal(calls, 1);
  assert.throws(() => parseContract(productListModel, { access_token: 'secret' }), /fora do contrato/);
});
test('Bling read models: identity, empty SKU, inactive, duplicate names, variations, flags, distinct balances', () => {
  const product = { id: 1, nome: 'Same', codigo: '', tipo: 'P', situacao: 'I', formato: 'S', token: 'discard' };
  assert.equal(productListModel.parse(product).id, '1'); assert.equal(productListModel.parse(product).codigo, '');
  assert.equal(productListModel.parse(product).situacao, 'I'); assert.notEqual(productListModel.parse(product).id, productListModel.parse({ ...product, id: 2 }).id);
  assert.ok(!('token' in productListModel.parse(product)));
  const detail = productDetailModel.parse({ ...product, id: 2, variacao: { nome: 'Cor:verde', ordem: 1, produtoPai: { id: 1 } }, variacoes: [{ ...product, id: 3 }] });
  assert.equal(detail.id, '2'); assert.equal(detail.variacao?.produtoPai.id, '1'); assert.equal(detail.variacoes?.[0]?.id, '3');
  assert.equal(warehouseModel.parse({ id: 5, descricao: 'Geral', situacao: 0, padrao: false, desconsiderarSaldo: true }).desconsiderarSaldo, true);
  const stock = stockModel.parse({ produto: { id: 2 }, saldoFisicoTotal: 10, saldoVirtualTotal: 4, depositos: [{ id: 5, saldoFisico: 20, saldoVirtual: 7 }] });
  assert.equal(stock.produto.id, '2'); assert.equal(stock.saldoFisicoTotal, 10); assert.equal(stock.saldoVirtualTotal, 4); assert.equal(stock.depositos?.[0]?.id, '5');
  assert.equal(stock.depositos?.[0]?.saldoFisico, 20); // Never recompute totals.
  assert.throws(() => productListModel.parse({ ...product, id: Number.MAX_SAFE_INTEGER + 1 }));
  assert.throws(() => pagination.parse({ limit: 101 })); assert.throws(() => pagination.parse({ page: 0 }));
});
test('Bling real product list accepts observed E while detail remains A/I and IDs stay normalized', () => {
  // Sanitized five-item shape: the real probe rejected situacao at indexes 3 and 4.
  const fixture = { data: ['A', 'I', 'A', 'E', 'E'].map((situacao, index) => ({
    id: 101 + index, nome: `Synthetic product ${index + 1}`, codigo: `SKU-${index + 1}`,
    preco: 10 + index, tipo: 'P', situacao, formato: 'S', descricaoCurta: '',
  })) };
  const result = fixture.data.map(product => productListModel.parse(product));
  assert.deepEqual(result.map(product => product.situacao), ['A', 'I', 'A', 'E', 'E']);
  assert.deepEqual(result.map(product => product.id), ['101', '102', '103', '104', '105']);
  const observed = fixture.data[3]!;
  assert.equal(productListModel.parse({ ...observed, id: '104' }).id, '104');
  assert.throws(() => productListModel.parse({ ...observed, id: Number.MAX_SAFE_INTEGER + 1 }));
  assert.equal(productDetailModel.parse({ ...observed, situacao: 'A' }).situacao, 'A');
  assert.equal(productDetailModel.parse({ ...observed, situacao: 'I' }).situacao, 'I');
  assert.throws(() => parseContract(productDetailModel, observed), /fora do contrato/);
  assert.throws(() => productDetailModel.parse({ ...observed, situacao: 'X' }));
});
test('Bling product list status correction rejects unknown values without weakening other fields', () => {
  const product = { id: 101, nome: 'Synthetic product', tipo: 'P', situacao: 'A', formato: 'S' };
  for (const situacao of ['X', '', 'e', ' E ', null, undefined, 0, true]) {
    assert.throws(() => parseContract(productListModel, { ...product, situacao }), /fora do contrato/);
    assert.throws(() => parseContract(productDetailModel, { ...product, situacao }), /fora do contrato/);
  }
  assert.throws(() => productListModel.parse({ ...product, tipo: 'X' }));
  assert.throws(() => productListModel.parse({ ...product, formato: 'X' }));
  assert.throws(() => productListModel.parse({ ...product, preco: '10' }));
  assert.equal('privateField' in productListModel.parse({ ...product, privateField: 'discard' }), false);
});
test('Bling tenant isolation: company B cannot access A tokens/data', async () => {
  let calls = 0; const { client } = setup(async () => { calls++; return json({ data: [] }); });
  await assert.rejects(client.read('B', 'products', new URLSearchParams()), /não conectado/); assert.equal(calls, 0);
});

test('Bling OAuth routes: admin, state valid/invalid/expired/reuse, missing code, failure, sanitized status and tenant', async t => {
  const { default: Fastify } = await import('../server/node_modules/fastify/fastify.js');
  const { registerBlingRoutes } = await import('../server/src/bling.js');
  const store = new MemoryStore(); let exchanges = 0; let fail = false;
  const client = new BlingApiClient(store, credentials, async () => { exchanges++; return fail ? json({ access_token: 'private' }, 400) : json(tokens); }, async () => {});
  const app = Fastify({ logger: false }); app.decorateRequest('user', null);
  let user: any = { id: 'uA', companyId: 'A', role: 'admin' };
  app.addHook('onRequest', async req => { req.user = user; });
  await registerBlingRoutes(app, { store, client, credentials });
  t.after(() => app.close()); const base = '/api/integrations/bling';
  const begin = async () => { const res = await app.inject({ method: 'POST', url: `${base}/connect` }); assert.equal(res.statusCode, 200); return new URL(res.json().url).searchParams.get('state')!; };
  const callback = (state: string, code = 'fake-code') => app.inject(`${base}/callback?${new URLSearchParams({ state, code })}`);
  user.role = 'attendant';
  for (const route of ['connect', 'disconnect']) assert.equal((await app.inject({ method: 'POST', url: `${base}/${route}` })).statusCode, 403);
  user.role = 'admin';
  const state = await begin(); assert.equal(state.length, 43); assert.equal((await callback(state)).headers.location?.endsWith('bling=connected'), true);
  const status = (await app.inject(`${base}/status`)).json(); assert.deepEqual(Object.keys(status).sort(), ['configured','connected','connectedAt']); assert.equal(status.connected, true);
  assert.equal((await callback(state)).headers.location?.endsWith('bling=error'), true); assert.equal(exchanges, 1);
  assert.equal((await callback('x'.repeat(43))).headers.location?.endsWith('bling=error'), true);
  const expired = await begin(); store.states.get(expired)!.expires = 0; await callback(expired); assert.equal(exchanges, 1);
  const noCode = await begin(); assert.ok((await app.inject(`${base}/callback?state=${noCode}`)).headers.location?.endsWith('bling=error')); assert.equal(exchanges, 1);
  const foreign = await begin(); user = { id: 'uB', companyId: 'B', role: 'admin' }; await callback(foreign); assert.equal(exchanges, 1);
  assert.equal((await app.inject(`${base}/status`)).json().connected, false);
  user = { id: 'otherA', companyId: 'A', role: 'admin' }; await callback(foreign); assert.equal(exchanges, 1);
  user.id = 'uA'; fail = true; const failed = await begin(); await callback(failed); await callback(failed); assert.equal(exchanges, 2);
  assert.equal(store.rows.get('A')?.refresh, tokens.refresh_token);
  const disconnected = await app.inject({ method: 'POST', url: `${base}/disconnect` }); assert.equal(disconnected.statusCode, 200);
  assert.equal((await app.inject(`${base}/status`)).json().connected, false);
  user = null; assert.equal((await app.inject(`${base}/status`)).statusCode, 401);
});
test('Bling persistence source is limited to foundation tables, cross-instance locks and no Product Library writes', () => {
  const source = readFileSync('server/src/blingStore.ts', 'utf8');
  assert.match(source, /pg_advisory_xact_lock/); assert.match(source, /FOR UPDATE/); assert.match(source, /used_at IS NULL AND expires_at > now/);
  assert.match(source, /120000/); assert.match(source, /3100 : 340/);
  for (const file of ['bling.ts','blingClient.ts','blingStore.ts','blingQa.ts']) {
    const text = readFileSync(`server/src/${file}`, 'utf8');
    assert.doesNotMatch(text, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+(?:products|message_product_refs)\b/i);
    assert.doesNotMatch(text, /productStorage|ProductMessageCard|send-product|R2_/);
  }
});

test('Bling PostgreSQL budgets: joint reservations, hard daily limit, cooldown, committed failures and encrypted rotation', async t => {
  const { db } = await import('../server/src/db.js');
  const { PgBlingStore } = await import('../server/src/blingStore.js');
  const cipher = integrationCipher(randomBytes(32).toString('base64'));
  let row: any = null; let blocked = false;
  const statements: string[] = []; const reservations: [string,number][] = []; const sleeps: number[] = [];
  t.mock.method(db as any, 'connect', async () => ({ release() {}, async query(text: string, args: any[] = []) {
    statements.push(text);
    if (text.startsWith('SELECT * FROM bling_connections')) return { rows: row ? [row] : [] };
    if (text.startsWith('INSERT INTO bling_connections')) row = { access_token_encrypted: args[1], refresh_token_encrypted: args[2], access_token_expires_at: new Date(Date.now()+args[3]*1000), connected_at: new Date() };
    if (text.startsWith('SELECT *, extract')) return { rows: [{ wait_ms: args[0] === 'oauth' ? 250 : 100, same_day: true, requests: blocked ? 120000 : 0 }] };
    if (text.includes('requests=CASE')) reservations.push([args[0],args[1]]);
    return { rows: [] };
  } }));
  const store = new PgBlingStore(cipher, async ms => { sleeps.push(ms); }, db);
  await store.locked('A', async session => { await session.budget('oauth'); await session.save(tokens); });
  assert.deepEqual(reservations, [['api',340],['oauth',3100]]); assert.deepEqual(sleeps, [250]);
  assert.ok(!JSON.stringify(row).includes(tokens.refresh_token)); assert.equal(cipher.decrypt(row.refresh_token_encrypted, 'A', 'refresh'), tokens.refresh_token);
  assert.ok(statements.some(s => s.includes('pg_advisory_xact_lock'))); assert.ok(statements.includes('COMMIT'));
  blocked = true; const before = reservations.length;
  await assert.rejects(store.locked('A', s => s.budget('api')), /Limite diário/); assert.equal(reservations.length, before);
  blocked = false; statements.length = 0;
  await assert.rejects(store.locked('A', async s => { await s.save({ ...tokens, refresh_token: 'rotated' }); await s.cooldown('api', 60000); throw new BlingError(); }));
  assert.equal(cipher.decrypt(row.refresh_token_encrypted, 'A', 'refresh'), 'rotated'); assert.ok(statements.includes('COMMIT'));
  assert.ok(statements.some(s => s.includes('GREATEST(next_at')));
  const sqlTables = statements.flatMap(s => [...s.matchAll(/(?:FROM|INTO|UPDATE(?!\s+SET\b))\s+([a-z_]+)/gi)].map(m => m[1]));
  assert.ok(sqlTables.every(name => name!.startsWith('bling_')));
});
test('Bling callback request logging never includes query code/state or headers', async () => {
  const { safeRequestLog } = await import('../server/src/app.js');
  const value = safeRequestLog({ method: 'GET', id: 'test', url: '/api/integrations/bling/callback?code=PRIVATE_CODE&state=PRIVATE_STATE', headers: { authorization: 'PRIVATE_AUTH' } } as any);
  assert.equal(value.url, '/api/integrations/bling/callback'); assert.doesNotMatch(JSON.stringify(value), /PRIVATE/);
});

test('Bling delayed PostgreSQL budget acknowledgement cannot compress the dispatch window', async () => {
  const { PgBlingStore } = await import('../server/src/blingStore.js');
  const cipher = integrationCipher(randomBytes(32).toString('base64'));
  let nextAt = 0, delayed = false; const starts: number[] = [];
  const pool = { async connect() { return { release() {}, async query(sql: string, args: any[] = []) {
    if (sql.startsWith('SELECT * FROM bling_connections')) return { rows: [{
      access_token_encrypted: cipher.encrypt('qa.access.signature', 'A', 'access'),
      refresh_token_encrypted: cipher.encrypt('qa-refresh', 'A', 'refresh'),
      access_token_expires_at: new Date(Date.now()+3600000), connected_at: new Date(),
    }] };
    if (sql.startsWith('SELECT *, extract')) return { rows: [{ wait_ms: nextAt-Date.now(), same_day:true, requests:0 }] };
    if (sql.includes('requests=CASE')) {
      nextAt=Date.now()+args[1];
      // PostgreSQL has applied the reservation, but its acknowledgement is late.
      if (!delayed) { delayed=true; await new Promise(r=>setTimeout(r,700)); }
    }
    if (sql.includes('GREATEST(next_at')) nextAt=Math.max(nextAt,Date.now()+args[1]);
    return { rows:[] };
  } }; } };
  const store = new PgBlingStore(cipher, undefined, pool as any);
  const client = new BlingApiClient(store, credentials, async () => { starts.push(performance.now()); return json({ data:[] }); });
  for(let i=0;i<4;i++) await client.read('A','products',new URLSearchParams());
  assert.ok(starts[3]!-starts[0]! >= 1000, 'four dispatches must not fit in one second despite a late DB acknowledgement');
});

test('Bling optional configuration never prevents full backend startup', () => {
  const complete = { BLING_CLIENT_ID: 'qa-local-bling-client', BLING_CLIENT_SECRET: 'qa-local-bling-secret',
    BLING_REDIRECT_URI: 'https://api.example.test/api/integrations/bling/callback', INTEGRATION_ENCRYPTION_KEY: randomBytes(32).toString('base64') };
  const empty = Object.fromEntries(Object.keys(complete).map(key => [key, '']));
  const scenarios = [empty, { ...empty, BLING_CLIENT_ID: complete.BLING_CLIENT_ID },
    { ...empty, BLING_CLIENT_ID: complete.BLING_CLIENT_ID, BLING_CLIENT_SECRET: complete.BLING_CLIENT_SECRET },
    { ...complete, INTEGRATION_ENCRYPTION_KEY: 'invalid' }, { ...complete, BLING_REDIRECT_URI: 'not-a-url' }, complete];
  for (const [index, bling] of scenarios.entries()) {
    const child = spawnSync(process.execPath, ['--import', './server/node_modules/tsx/dist/loader.mjs', '--input-type=module', '-e', `
      import { createQaEnv } from './scripts/qa-env.mjs';
      Object.assign(process.env, createQaEnv(), { NODE_ENV:'test', QA_MODE:'false', PRODUCT_STORAGE_DRIVER:'memory' }, ${JSON.stringify(bling)});
      const { runtimeBling } = await import('./server/src/bling.ts');
      const dependencies = runtimeBling(); const configured = !!dependencies;
      await dependencies?.store.close?.();
      const { createApp } = await import('./server/src/app.ts');
      const app = await createApp(); await app.ready(); await app.close();
      const { db } = await import('./server/src/db.ts'); await db.end();
      console.log(JSON.stringify({ started:true, configured }));
    `], { encoding:'utf8', timeout:20000 });
    assert.equal(child.status, 0, `configuration scenario ${index} must start`);
    assert.match(child.stdout, new RegExp(`"started":true,"configured":${index === scenarios.length-1}`));
  }
});

test('Bling actual Fastify logging strips callback query, headers, body and response cookie', () => {
  const child = spawnSync(process.execPath, ['--import', './server/node_modules/tsx/dist/loader.mjs', '--input-type=module', '-e', `
    import { createQaEnv } from './scripts/qa-env.mjs';
    Object.assign(process.env, createQaEnv(), { NODE_ENV:'test', QA_MODE:'false', PRODUCT_STORAGE_DRIVER:'memory', BLING_CLIENT_ID:'', BLING_CLIENT_SECRET:'', BLING_REDIRECT_URI:'', INTEGRATION_ENCRYPTION_KEY:'' });
    const { db } = await import('./server/src/db.ts');
    const { hashPassword } = await import('./server/src/security/password.ts');
    const password = 'PRIVATE_PASSWORD'; const hash = await hashPassword(password);
    db.query = async sql => ({ rows: /FROM users|FROM sessions/.test(sql) ? [{ id:'u',company_id:'A',company_name:'QA',name:'QA',email:'qa@example.test',role:'admin',password_hash:hash,must_change_password:false }] : [] });
    const { createApp } = await import('./server/src/app.ts'); const app = await createApp();
    const login = await app.inject({ method:'POST', url:'/api/auth/login', headers:{authorization:'PRIVATE_AUTHORIZATION'}, payload:{email:'qa@example.test',password,client_secret:'PRIVATE_CLIENT_SECRET',access_token:'PRIVATE_ACCESS_TOKEN',refresh_token:'PRIVATE_REFRESH_TOKEN'} });
    if (login.statusCode !== 200 || !login.headers['set-cookie']) throw new Error('login fixture failed');
    const cookie = login.headers['set-cookie'].split(';')[0];
    await app.inject({ method:'GET', url:'/api/integrations/bling/callback?code=PRIVATE_CODE&state=PRIVATE_STATE', headers:{cookie,authorization:'PRIVATE_AUTHORIZATION'} });
    await app.close(); await db.end(); console.log('REAL_LOGGER_GATE_OK');
  `], { encoding:'utf8', timeout:20000 });
  assert.equal(child.status, 0, 'real logger fixture must complete');
  assert.match(child.stdout, /REAL_LOGGER_GATE_OK/);
  assert.match(child.stdout, /incoming request/); assert.match(child.stdout, /request completed/);
  assert.doesNotMatch(child.stdout, /PRIVATE_|vitstock_session=|set-cookie/i);
});

test('Bling contact lookup phone normalization accepts explicit Brazilian formats and never guesses a ninth digit', () => {
  const national = normalizeBlingLookupPhone('(21) 99000-0011');
  assert.deepEqual(national, { digits: '5521990000011', formatted: '(21) 99000-0011' });
  assert.deepEqual(normalizeBlingLookupPhone('+55 21 99000-0011'), national);
  assert.deepEqual(normalizeBlingLookupPhone('0055 (21) 99000-0011'), national);
  assert.deepEqual(normalizeBlingLookupPhone('5521990000011@s.whatsapp.net'), national);
  assert.equal(normalizeBlingLookupPhone('(21) 4000-0011')?.formatted, '(21) 4000-0011');
  assert.equal(normalizeBlingLookupPhone('+1 212 555 0100'), null);
  assert.equal(normalizeBlingLookupPhone('2199000011@lid'), null);
  assert.equal(normalizeBlingLookupPhone('21 99000-0011 ramal 3'), null);
  assert.equal(blingPhoneMatches('(21) 9000-0011', national!), false);
  assert.equal(blingPhoneMatches('+55 21 99000-0011', national!), true);
});

test('Bling contact display formats only complete CPF/CNPJ/CEP values and creates safe map search URLs', () => {
  assert.equal(formatBlingDocument('12345678901'), '123.456.789-01');
  assert.equal(formatBlingDocument('12345678000199'), '12.345.678/0001-99');
  assert.equal(formatBlingDocument('1234567890'), '1234567890');
  assert.equal(formatBlingDocument(null), null);
  assert.equal(formatBlingZipCode('20000011'), '20000-011');
  assert.equal(formatBlingZipCode('1234567'), '1234567');
  assert.equal(formatBlingZipCode(''), '');
  assert.equal(googleMapsSearchUrl('Rua QA, 10, Centro'), 'https://www.google.com/maps/search/?api=1&query=Rua+QA%2C+10%2C+Centro');
  assert.equal(googleMapsSearchUrl('  '), null);
});

test('Bling contact lookup uses the tenant snapshot, asks on duplicates, and sorts linked orders by date', async t => {
  const { default: Fastify } = await import('../server/node_modules/fastify/fastify.js');
  const { registerBlingRoutes } = await import('../server/src/bling.js');
  const store = new MemoryStore();
  store.rows.set('A', { access: 'jwt.old.signature', refresh: 'refresh-old', expires: Date.now() + 3600000, connectedAt: 'today' });
  const first = { id: 901, nome: 'Ana QA', situacao: 'A', numeroDocumento: '123.456.789-01', telefone: '(21) 4000-0011', celular: '(21) 99000-0011' };
  const second = { id: 902, nome: 'Ana Empresa QA', situacao: 'A', numeroDocumento: '12.345.678/0001-90', telefone: '+55 21 99000-0011', celular: null };
  let ordersMode: 'normal' | 'empty' | 'forbidden' = 'normal';
  const requestedUrls: URL[] = [];
  const syncedAt = new Date().toISOString();
  const directoryEntries = [
    { id: '901', name: first.nome, document: first.numeroDocumento, phone: first.telefone, mobile: first.celular, status: first.situacao },
    { id: '902', name: second.nome, document: second.numeroDocumento, phone: second.telefone, mobile: null, status: second.situacao },
  ];
  const contactDirectoryRepository = {
    tryAcquireSyncLock: async () => async () => undefined,
    activeGeneration: async (companyId: string) => companyId === 'A' ? { id: 'generation-A', syncedAt, count: directoryEntries.length } : null,
    startGeneration: async () => undefined,
    upsertPage: async () => undefined,
    publishGeneration: async () => directoryEntries.length,
    discardGeneration: async () => undefined,
    findByPhone: async (companyId: string, generationId: string, digits: string, limit: number) => companyId === 'A' && generationId === 'generation-A'
      ? directoryEntries.filter(contact => [contact.phone, contact.mobile].some(value => normalizeBlingLookupPhone(value)?.digits === digits)).slice(0, limit)
      : [],
    findById: async (companyId: string, generationId: string, id: string) => companyId === 'A' && generationId === 'generation-A'
      ? directoryEntries.find(contact => contact.id === id) ?? null : null,
  };
  const client = new BlingApiClient(store, credentials, async url => {
    const target = new URL(url);
    requestedUrls.push(target);
    if (target.pathname === '/Api/v3/contatos') throw new Error('contact lookup must use its local snapshot');
    if (target.pathname === '/Api/v3/contatos/901') return json({ data: {
      ...first, fantasia: 'Ana Comércio', tipo: 'F', email: 'ana@example.test',
      endereco: { geral: { cep: '20000-011', endereco: 'Rua QA', numero: '11', bairro: 'Centro', municipio: 'Rio de Janeiro', uf: 'RJ' } },
    } });
    if (target.pathname === '/Api/v3/pedidos/vendas') {
      assert.equal(target.searchParams.get('idContato'), '901');
      if (ordersMode === 'forbidden') return json({}, 403);
      if (ordersMode === 'empty') return json({ data: [] });
      return json({ data: [
        { id: 11, numero: 11, data: '2026-09-10', total: 100, situacao: { id: 90902, valor: 'Personalizado QA' } },
        { id: 12, numero: 12, data: '2026-10-01', total: 215.5, situacao: { id: 90901, valor: 'Em separação QA' } },
      ] });
    }
    return json({}, 404);
  }, async () => {});
  const app = Fastify({ logger: false }); app.decorateRequest('user', null);
  let user: any = { id: 'attendant-A', companyId: 'A', role: 'attendant' };
  app.addHook('onRequest', async request => { request.user = user; });
  await registerBlingRoutes(app, { store, client, credentials, contactDirectoryRepository });
  t.after(() => app.close());

  const lookup = (payload: Record<string, string>) => app.inject({ method: 'POST', url: '/api/integrations/bling/contact-lookup', payload });
  const duplicateResult = await lookup({ phone: '+55 21 99000-0011' });
  assert.equal(duplicateResult.statusCode, 200);
  assert.deepEqual(duplicateResult.json(), {
    status: 'multiple', truncated: false,
    matches: [
      { id: '901', name: 'Ana QA', document: '123.456.789-01', phone: '(21) 99000-0011', mobile: '(21) 99000-0011' },
      { id: '902', name: 'Ana Empresa QA', document: '12.345.678/0001-90', phone: '+55 21 99000-0011', mobile: null },
    ],
  });
  assert.equal(requestedUrls.some(url => url.pathname === '/Api/v3/contatos'), false, 'conversation lookup must not scan provider contacts');

  const selected = await lookup({ phone: '5521990000011', contactId: '901' });
  assert.equal(selected.statusCode, 200);
  const result = selected.json();
  assert.equal(result.status, 'found');
  assert.deepEqual(result.contact, {
    id: '901', name: 'Ana QA', fantasy: 'Ana Comércio', document: '123.456.789-01', zipCode: '20000-011',
    address: 'Rua QA, 11, Centro, Rio de Janeiro, RJ', phone: '(21) 99000-0011', mobile: '(21) 99000-0011', email: 'ana@example.test',
  });
  assert.deepEqual(result.orders.map((order: { number: string }) => order.number), ['12', '11']);
  assert.deepEqual(result.orders.map((order: { status: string }) => order.status), ['Em separação QA', 'Personalizado QA']);
  assert.deepEqual(result.orders.map((order: { statusId: string }) => order.statusId), ['90901', '90902']);
  assert.equal(result.directorySyncedAt, syncedAt);
  assert.equal(requestedUrls.some(url => url.pathname === '/Api/v3/contatos/901'), true);
  assert.equal(requestedUrls.some(url => url.pathname === '/Api/v3/pedidos/vendas' && url.searchParams.get('idContato') === '901'), true);

  ordersMode = 'empty';
  const withoutOrders = await lookup({ phone: '5521990000011', contactId: '901' });
  assert.equal(withoutOrders.json().status, 'found');
  assert.deepEqual(withoutOrders.json().orders, []);
  assert.equal(withoutOrders.json().ordersError, null);
  ordersMode = 'forbidden';
  const orderPermissionError = await lookup({ phone: '5521990000011', contactId: '901' });
  assert.equal(orderPermissionError.json().status, 'found');
  assert.match(orderPermissionError.json().ordersError, /permissões da integração/);

  directoryEntries.splice(0, directoryEntries.length);
  assert.deepEqual((await lookup({ phone: '5521990000011' })).json(), { status: 'not_found' });
  user = null;
  assert.equal((await lookup({ phone: '5521990000011' })).statusCode, 401);
});

test('Bling contact existence is tenant-scoped and unavailable without a fresh complete snapshot', async t => {
  const { default: Fastify } = await import('../server/node_modules/fastify/fastify.js');
  const { registerBlingRoutes } = await import('../server/src/bling.js');
  const store = new MemoryStore();
  store.rows.set('A', { access: 'jwt.old.signature', refresh: 'refresh-old', expires: Date.now() + 3600000, connectedAt: 'today' });
  store.rows.set('B', { access: 'jwt.old.signature', refresh: 'refresh-old', expires: Date.now() + 3600000, connectedAt: 'today' });
  const client = new BlingApiClient(store, credentials, async () => json({ data: [] }), async () => {});
  const syncedAt = new Date().toISOString();
  const repository = {
    tryAcquireSyncLock: async () => async () => undefined,
    activeGeneration: async (companyId: string) => companyId === 'A' ? { id: 'A-gen', syncedAt, count: 1 } : null,
    startGeneration: async () => undefined, upsertPage: async () => undefined, publishGeneration: async () => 0, discardGeneration: async () => undefined,
    findByPhone: async (companyId: string, generationId: string, digits: string) => companyId === 'A' && generationId === 'A-gen' && digits === '5521990000011'
      ? [{ id: '901', name: 'Contato A', document: null, phone: null, mobile: '(21) 99000-0011', status: 'A' }] : [],
    findById: async () => null,
  };
  const app = Fastify({ logger: false }); app.decorateRequest('user', null);
  let user: any = { id: 'A-user', companyId: 'A', role: 'attendant' };
  app.addHook('onRequest', async request => { request.user = user; });
  await registerBlingRoutes(app, { store, client, credentials, contactDirectoryRepository: repository });
  t.after(() => app.close());

  const check = () => app.inject({ method: 'POST', url: '/api/integrations/bling/contact-existence', payload: { phone: '(21) 99000-0011' } });
  assert.equal((await check()).json().status, 'found');
  user = { id: 'B-user', companyId: 'B', role: 'attendant' };
  const noSnapshot = await check();
  assert.equal(noSnapshot.statusCode, 200);
  assert.equal(noSnapshot.json().status, 'unavailable');
});
